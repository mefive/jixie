import { prisma } from '../lib/prisma.js';
import {
  CHINA_TREASURY_CURVE_CODE,
  CHINA_TREASURY_CURVE_SOURCE,
  CHINA_TREASURY_CURVE_TYPE,
} from '../rates/china-treasury-curve.js';
import type { BarsRows, EngineDataPort } from './data-port.js';

// Kept in its own module (not data-port.ts) so the Phase B2 engine bundle can alias THIS file
// to the isolate bridge — nothing inside the wall may pull in Prisma.
/** The direct-lane implementation: Prisma queries, one per method (barsRows chunks internally —
 * a whole-universe, full-history findMany would overflow the query engine's result marshaling). */
export const prismaDataPort: EngineDataPort = {
  async openDates(start, end) {
    const rows = await prisma.tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1, calDate: { gte: start, lte: end } },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    });
    return rows.map((row) => row.calDate);
  },

  async stockBasics() {
    return prisma.stockBasic.findMany({
      select: { tsCode: true, listDate: true, industry: true },
    });
  },

  async stockNameHistory() {
    return prisma.stockNameHistory.findMany({
      select: { tsCode: true, name: true, startDate: true, endDate: true },
      orderBy: [{ tsCode: 'asc' }, { startDate: 'asc' }],
    });
  },

  async etfBasics() {
    return prisma.etfBasic.findMany({
      select: { tsCode: true, listDate: true, sameDayTurnover: true },
    });
  },

  async topListRange(start, end) {
    return prisma.topList.findMany({
      where: { tradeDate: { gte: start, lte: end } },
      select: { tsCode: true, tradeDate: true, netAmount: true },
    });
  },

  async indexDailyAll() {
    return prisma.indexDaily.findMany({
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    });
  },

  async indexDailyBasicAll() {
    return prisma.indexDailyBasic.findMany({
      select: { tsCode: true, tradeDate: true, pe: true, peTtm: true, pb: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    });
  },

  async yieldCurvePoints(end) {
    return prisma.yieldCurvePoint.findMany({
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
    return prisma.moneyflow.findMany({
      where: { tradeDate: { gte: start, lte: end } },
      select: { tsCode: true, tradeDate: true, netMain: true, netTotal: true },
    });
  },

  async crossSectionRows(date, codes) {
    const where = codes ? { tradeDate: date, tsCode: { in: codes } } : { tradeDate: date };
    const [price, adj, basic] = await Promise.all([
      prisma.daily.findMany({
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
      prisma.adjFactor.findMany({ where, select: { tsCode: true, adjFactor: true } }),
      prisma.dailyBasic.findMany({
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
    const rows = await prisma.finaIndicator.findMany({
      where: { annDate: { not: null } }, // only reports with a public date can be used point-in-time
      select: {
        tsCode: true,
        annDate: true,
        roe: true,
        roeWaa: true,
        grossprofitMargin: true,
        debtToAssets: true,
      },
      orderBy: [{ tsCode: 'asc' }, { annDate: 'asc' }],
    });
    return rows.map((row) => ({ ...row, annDate: row.annDate! }));
  },

  async indexWeights(indexCode) {
    return prisma.indexWeight.findMany({
      where: { indexCode },
      select: { conCode: true, tradeDate: true },
      orderBy: { tradeDate: 'asc' },
    });
  },

  async barsRows(codes, start, end, options) {
    const out: BarsRows = { px: [], adj: [], limits: [], turnoverRatesF: [] };
    const CHUNK = 300; // codes per batch — bounds each query's result (full-history × N codes)
    for (let off = 0; off < codes.length; off += CHUNK) {
      const batch = codes.slice(off, off + CHUNK);
      const range = { gte: start, lte: end };
      const [px, etfPx, adj, etfAdj, limits, turnoverRatesF] = await Promise.all([
        prisma.daily.findMany({
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
        prisma.etfDaily.findMany({
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
        prisma.adjFactor.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: { tsCode: true, tradeDate: true, adjFactor: true },
        }),
        prisma.etfAdjFactor.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: { tsCode: true, tradeDate: true, adjFactor: true },
        }),
        prisma.stkLimit.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: { tsCode: true, tradeDate: true, upLimit: true, downLimit: true },
        }),
        options?.includeTurnoverRateF
          ? prisma.dailyBasic.findMany({
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

  async futuresRange(start, end) {
    const range = { gte: start, lte: end };
    const contracts = await prisma.futureContract.findMany({
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
      prisma.futureDaily.findMany({
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
      prisma.futureMapping.findMany({
        where: {
          continuousCode: { in: ['IF.CFX', 'IH.CFX', 'IC.CFX', 'IM.CFX'] },
          tradeDate: range,
        },
        select: { continuousCode: true, tradeDate: true, mappedTsCode: true },
        orderBy: [{ continuousCode: 'asc' }, { tradeDate: 'asc' }],
      }),
      prisma.futureSettlement.findMany({
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
