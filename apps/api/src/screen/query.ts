import type { ScreenResult, ScreenRow, ScreenSpec, StockSeries } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { applyScreen } from './spec.js';

/** The most recent trade date present in daily_basic (the snapshot the screener runs on). */
async function latestSnapshotDate(): Promise<string | null> {
  const row = await prisma.dailyBasic.findFirst({
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  return row?.tradeDate ?? null;
}

/** Run a screen against the latest whole-market snapshot. Loads that day's daily_basic + daily +
 * stock list once, builds one ScreenRow per stock, then applies the (pure) filter/sort/limit. */
export async function runScreen(spec: ScreenSpec): Promise<ScreenResult> {
  const date = await latestSnapshotDate();
  if (!date) {
    return { tradeDate: '', total: 0, rows: [] };
  }

  const [db, px, basics] = await Promise.all([
    prisma.dailyBasic.findMany({ where: { tradeDate: date } }),
    prisma.daily.findMany({
      where: { tradeDate: date },
      select: { tsCode: true, close: true, pctChg: true },
    }),
    prisma.stockBasic.findMany({ select: { tsCode: true, name: true, industry: true } }),
  ]);
  const pxMap = new Map(px.map((r) => [r.tsCode, r]));
  const basicMap = new Map(basics.map((b) => [b.tsCode, b]));

  const rows: ScreenRow[] = db.map((r) => {
    const p = pxMap.get(r.tsCode);
    const b = basicMap.get(r.tsCode);
    return {
      tsCode: r.tsCode,
      name: b?.name ?? r.tsCode,
      industry: b?.industry ?? null,
      tradeDate: date,
      close: p?.close ?? null,
      pctChg: p?.pctChg ?? null,
      pe: r.pe,
      peTtm: r.peTtm,
      pb: r.pb,
      ps: r.ps,
      dvRatio: r.dvRatio,
      totalMv: r.totalMv,
      circMv: r.circMv,
      turnoverRate: r.turnoverRate,
    };
  });

  const { total, rows: picked } = applyScreen(rows, spec);
  return { tradeDate: date, total, rows: picked };
}

/** A stock's raw OHLC + volume + pe series over a date range, for the K线/PE/量 charts. */
export async function stockSeries(
  tsCode: string,
  start: string,
  end: string,
): Promise<StockSeries> {
  const [px, db, adj, basic] = await Promise.all([
    prisma.daily.findMany({
      where: { tsCode, tradeDate: { gte: start, lte: end } },
      select: { tradeDate: true, open: true, high: true, low: true, close: true, vol: true },
      orderBy: { tradeDate: 'asc' },
    }),
    prisma.dailyBasic.findMany({
      where: { tsCode, tradeDate: { gte: start, lte: end } },
      select: { tradeDate: true, pe: true },
    }),
    prisma.adjFactor.findMany({
      where: { tsCode, tradeDate: { gte: start, lte: end } },
      select: { tradeDate: true, adjFactor: true },
    }),
    prisma.stockBasic.findUnique({ where: { tsCode }, select: { name: true } }),
  ]);
  const peMap = new Map(db.map((r) => [r.tradeDate, r.pe]));
  const adjMap = new Map(adj.map((r) => [r.tradeDate, r.adjFactor]));

  return {
    tsCode,
    name: basic?.name ?? tsCode,
    points: px.map((r) => ({
      date: r.tradeDate,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      vol: r.vol,
      pe: peMap.get(r.tradeDate) ?? null,
      adjFactor: adjMap.get(r.tradeDate) ?? null,
    })),
  };
}
