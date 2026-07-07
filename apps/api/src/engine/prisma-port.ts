import { prisma } from '../lib/prisma.js';
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
      select: { tsCode: true, annDate: true, roe: true, roeWaa: true },
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

  async barsRows(codes, start, end) {
    const out: BarsRows = { px: [], adj: [], limits: [] };
    const CHUNK = 300; // codes per batch — bounds each query's result (full-history × N codes)
    for (let off = 0; off < codes.length; off += CHUNK) {
      const batch = codes.slice(off, off + CHUNK);
      const range = { gte: start, lte: end };
      const [px, adj, limits] = await Promise.all([
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
        prisma.adjFactor.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: { tsCode: true, tradeDate: true, adjFactor: true },
        }),
        prisma.stkLimit.findMany({
          where: { tsCode: { in: batch }, tradeDate: range },
          select: { tsCode: true, tradeDate: true, upLimit: true, downLimit: true },
        }),
      ]);
      // concat, not push-spread — spreading a chunk of hundreds of thousands of rows as call
      // arguments overflows the call stack.
      out.px = out.px.concat(px);
      out.adj = out.adj.concat(adj);
      out.limits = out.limits.concat(limits);
    }
    return out;
  },
};
