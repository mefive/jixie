import { getDatabase } from '#infra/database/prisma.js';
import {
  CHINA_TREASURY_CURVE_CODE,
  CHINA_TREASURY_CURVE_SOURCE,
  CHINA_TREASURY_CURVE_TYPE,
} from '#market/registry/yield-curves.js';
import type { BarsRows, EngineDataPort } from '../data/data-port.js';

// Kept in its own module (not data-port.ts) so the Phase B2 engine bundle can alias THIS file
// to the isolate bridge — nothing inside the wall may pull in Prisma.
/** The direct-lane implementation: Prisma queries, one per method (barsRows chunks internally —
 * a whole-universe, full-history findMany would overflow the query engine's result marshaling). */
export const prismaDataPort: EngineDataPort = {
  async openDates(start, end) {
    const rows = await getDatabase().tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1, calDate: { gte: start, lte: end } },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    });
    return rows.map((row) => row.calDate);
  },

  async stockBasics() {
    return getDatabase().stockBasic.findMany({
      select: {
        tsCode: true,
        listDate: true,
        delistDate: true,
        listStatus: true,
      },
    });
  },

  async industryMemberships() {
    return getDatabase().swIndustryMember.findMany({
      select: { tsCode: true, l1Name: true, inDate: true, outDate: true },
      orderBy: [{ tsCode: 'asc' }, { inDate: 'asc' }],
    });
  },

  async stockNameHistory() {
    return getDatabase().stockNameHistory.findMany({
      select: { tsCode: true, name: true, startDate: true, endDate: true },
      orderBy: [{ tsCode: 'asc' }, { startDate: 'asc' }],
    });
  },

  async etfBasics() {
    return getDatabase().etfBasic.findMany({
      select: {
        tsCode: true,
        listDate: true,
        delistDate: true,
        listStatus: true,
        sameDayTurnover: true,
      },
    });
  },

  async topListRange(start, end) {
    return getDatabase().topList.findMany({
      where: { tradeDate: { gte: start, lte: end } },
      select: { tsCode: true, tradeDate: true, netAmount: true },
    });
  },

  async indexDailyAll() {
    return getDatabase().indexDaily.findMany({
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    });
  },

  async indexDailyBasicAll() {
    return getDatabase().indexDailyBasic.findMany({
      select: { tsCode: true, tradeDate: true, pe: true, peTtm: true, pb: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    });
  },

  async yieldCurvePoints(end) {
    return getDatabase().yieldCurvePoint.findMany({
      where: {
        source: CHINA_TREASURY_CURVE_SOURCE,
        curveCode: CHINA_TREASURY_CURVE_CODE,
        curveType: CHINA_TREASURY_CURVE_TYPE,
        availableDate: { lte: end },
      },
      select: { availableDate: true, termYears: true, yieldPct: true },
      orderBy: [{ termYears: 'asc' }, { availableDate: 'asc' }],
    });
  },

  async moneyflowRange(start, end) {
    return getDatabase().moneyflow.findMany({
      where: { tradeDate: { gte: start, lte: end } },
      select: { tsCode: true, tradeDate: true, netMain: true, netTotal: true },
    });
  },

  /**
   * 为模拟引擎批量读取指定日期的行情、复权和估值原始截面，时点筛选由 EngineData 负责。
   *
   * Load raw daily price, adjustment and valuation rows for the simulation data port; EngineData applies visibility rules.
   */
  async crossSectionRows(date, codes) {
    const where = codes ? { tradeDate: date, tsCode: { in: codes } } : { tradeDate: date };
    const [price, adj, basic] = await Promise.all([
      getDatabase().daily.findMany({
        where,
        select: {
          tsCode: true,
          open: true,
          high: true,
          low: true,
          close: true,
          vol: true,
          amount: true,
        },
      }),
      getDatabase().adjFactor.findMany({ where, select: { tsCode: true, adjFactor: true } }),
      getDatabase().dailyBasic.findMany({
        where,
        // Only the valuation columns BarRow exposes. Fetching the full row roughly doubled the
        // per-day cost — Prisma row deserialization dominates (measured 171ms→87ms full-market).
        select: {
          tsCode: true,
          pe: true,
          peTtm: true,
          pb: true,
          ps: true,
          psTtm: true,
          dvRatio: true,
          dvTtm: true,
          totalMv: true,
          circMv: true,
          turnoverRate: true,
        },
      }),
    ]);
    return { price, adj, basic };
  },

  async finaIndicators() {
    const rows = await getDatabase().finaIndicator.findMany({
      where: { annDate: { not: null } }, // only reports with a public date can be used point-in-time
      select: {
        tsCode: true,
        annDate: true,
        roe: true,
        roeWaa: true,
        roa: true,
        grossprofitMargin: true,
        debtToAssets: true,
      },
      orderBy: [{ tsCode: 'asc' }, { annDate: 'asc' }],
    });
    return rows.map((row) => ({ ...row, annDate: row.annDate! }));
  },

  async indexWeights(indexCode) {
    return getDatabase().indexWeight.findMany({
      where: { indexCode },
      select: { conCode: true, tradeDate: true },
      orderBy: { tradeDate: 'asc' },
    });
  },

  /**
   * 按代码和日期范围准备原始行情及所需辅助历史，供引擎批量建立价格缓存。
   *
   * Fetch raw bars and requested auxiliary histories so the engine can populate its per-instrument caches.
   */
  async barsRows(codes, start, end, options) {
    const out: BarsRows = { px: [], adj: [], limits: [], turnoverRatesF: [] };
    const CHUNK = 300; // codes per batch — bounds each query's result (full-history × N codes)
    for (let off = 0; off < codes.length; off += CHUNK) {
      const batch = codes.slice(off, off + CHUNK);
      const range = { gte: start, lte: end };
      const [px, etfPx, adj, etfAdj, limits, turnoverRatesF] = await Promise.all([
        getDatabase().daily.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: {
            tsCode: true,
            tradeDate: true,
            open: true,
            high: true,
            low: true,
            close: true,
            vol: true,
            amount: true,
          },
          orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
        }),
        getDatabase().etfDaily.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: {
            tsCode: true,
            tradeDate: true,
            open: true,
            high: true,
            low: true,
            close: true,
            vol: true,
            amount: true,
          },
          orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
        }),
        getDatabase().adjFactor.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: { tsCode: true, tradeDate: true, adjFactor: true },
        }),
        getDatabase().etfAdjFactor.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: { tsCode: true, tradeDate: true, adjFactor: true },
        }),
        getDatabase().stkLimit.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: { tsCode: true, tradeDate: true, upLimit: true, downLimit: true },
        }),
        options?.includeTurnoverRateF
          ? getDatabase().dailyBasic.findMany({
              where: { tsCode: { in: batch }, tradeDate: range },
              select: { tsCode: true, tradeDate: true, turnoverRateF: true },
            })
          : Promise.resolve([]),
      ]);
      // concat, not push-spread — spreading a chunk of hundreds of thousands of rows as call
      // arguments overflows the call stack.
      out.px = out.px.concat(px, etfPx);
      out.adj = out.adj.concat(adj, etfAdj);
      out.limits = out.limits.concat(limits);
      out.turnoverRatesF = out.turnoverRatesF.concat(turnoverRatesF);
    }
    return out;
  },

  /**
   * 按回测区间组合期货合约、行情、主力映射和结算数据，供引擎建立期货市场视图。
   *
   * Assemble futures contracts, bars, mappings and settlements for the simulation range.
   */
  async futuresRange(start, end) {
    const range = { gte: start, lte: end };
    const contracts = await getDatabase().futureContract.findMany({
      where: {
        productCode: { in: ['IF', 'IH', 'IC', 'IM'] },
        multiplier: { not: null },
        listDate: { lte: end },
        delistDate: { gte: start },
      },
      select: {
        tsCode: true,
        productCode: true,
        multiplier: true,
        listDate: true,
        delistDate: true,
      },
    });
    const contractCodes = contracts.map((contract) => contract.tsCode);
    const [daily, mappings, settlements] = await Promise.all([
      getDatabase().futureDaily.findMany({
        where: { tsCode: { in: contractCodes }, tradeDate: range },
        select: {
          tsCode: true,
          tradeDate: true,
          open: true,
          high: true,
          low: true,
          close: true,
          settle: true,
          volume: true,
          amount: true,
          openInterest: true,
        },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
      }),
      getDatabase().futureMapping.findMany({
        where: {
          continuousCode: { in: ['IF.CFX', 'IH.CFX', 'IC.CFX', 'IM.CFX'] },
          tradeDate: range,
        },
        select: { continuousCode: true, tradeDate: true, mappedTsCode: true },
        orderBy: [{ continuousCode: 'asc' }, { tradeDate: 'asc' }],
      }),
      getDatabase().futureSettlement.findMany({
        where: { tsCode: { in: contractCodes }, tradeDate: range },
        select: { tsCode: true, tradeDate: true, longMarginRate: true, shortMarginRate: true },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
      }),
    ]);
    return {
      contracts: contracts.map((contract) => ({
        ...contract,
        multiplier: contract.multiplier!,
      })),
      daily,
      mappings,
      settlements,
    };
  },
};
