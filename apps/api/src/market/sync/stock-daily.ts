import type { TradeDate } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { log } from '../../infra/logging.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import {
  adjFactor,
  daily,
  dailyBasic,
  stkLimit,
  type AdjFactorRow,
  type DailyBasicRow,
  type DailyRow,
  type StkLimitRow,
} from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/client.js';
import { getOpenDates, syncTradeCal } from './calendar.js';

export interface DailyCoreSyncSummary {
  tradeDate: string;
  daily: number;
  adjustment: number;
  basic: number;
  limits: number;
  priorMedianDaily: number | null;
}

/**
 * Fetch, validate, and atomically publish the four dense stock datasets required by every daily
 * calculation. No database row for the target date changes before every candidate has passed.
 */
export async function syncDailyCoreDate(
  client: TushareClient,
  tradeDate: TradeDate,
): Promise<DailyCoreSyncSummary> {
  const [priceRows, adjustmentRows, basicRows, limitRows] = await Promise.all([
    daily(client, { trade_date: tradeDate }),
    adjFactor(client, { trade_date: tradeDate }),
    dailyBasic(client, { trade_date: tradeDate }),
    stkLimit(client, { trade_date: tradeDate }),
  ]);
  const prices = canonicalizeCandidateRows(priceRows, tradeDate, 'Daily');
  const adjustments = canonicalizeCandidateRows(adjustmentRows, tradeDate, 'AdjFactor');
  const basics = canonicalizeCandidateRows(basicRows, tradeDate, 'DailyBasic');
  const limits = canonicalizeCandidateRows(limitRows, tradeDate, 'StkLimit');
  const priorMedianDaily = await recentDailyCountMedian(tradeDate);

  validateDailyCoreCandidates({
    tradeDate,
    prices,
    adjustments,
    basics,
    limits,
    priorMedianDaily,
  });

  await prisma.$transaction([
    prisma.daily.deleteMany({ where: { tradeDate } }),
    prisma.daily.createMany({ data: prices.map(toDaily) }),
    prisma.adjFactor.deleteMany({ where: { tradeDate } }),
    prisma.adjFactor.createMany({
      data: adjustments.map((row) => ({
        tsCode: canonicalStockCode(row.ts_code),
        tradeDate: row.trade_date,
        adjFactor: row.adj_factor,
      })),
    }),
    prisma.dailyBasic.deleteMany({ where: { tradeDate } }),
    prisma.dailyBasic.createMany({ data: basics.map(toDailyBasic) }),
    prisma.stkLimit.deleteMany({ where: { tradeDate } }),
    prisma.stkLimit.createMany({ data: limits.map(toStkLimit) }),
  ]);

  return {
    tradeDate,
    daily: prices.length,
    adjustment: adjustments.length,
    basic: basics.length,
    limits: limits.length,
    priorMedianDaily,
  };
}

function canonicalizeCandidateRows<Row extends { ts_code: string; trade_date: string }>(
  rows: Row[],
  tradeDate: string,
  table: string,
): Row[] {
  const canonical = new Map<string, Row>();
  for (const row of rows) {
    if (row.trade_date !== tradeDate) {
      throw new Error(`${table} returned unexpected date ${row.trade_date} for ${tradeDate}`);
    }
    const code = canonicalStockCode(row.ts_code);
    if (canonical.has(code)) {
      throw new Error(`${table} returned duplicate canonical code ${code} for ${tradeDate}`);
    }
    canonical.set(code, { ...row, ts_code: code });
  }
  return [...canonical.values()];
}

async function recentDailyCountMedian(tradeDate: string): Promise<number | null> {
  const rows = await prisma.daily.groupBy({
    by: ['tradeDate'],
    where: { tradeDate: { lt: tradeDate } },
    _count: { _all: true },
    orderBy: { tradeDate: 'desc' },
    take: 20,
  });
  if (rows.length < 5) {
    return null;
  }
  const counts = rows.map((row) => row._count._all).sort((left, right) => left - right);
  const middle = Math.floor(counts.length / 2);
  return counts.length % 2 === 0 ? (counts[middle - 1] + counts[middle]) / 2 : counts[middle];
}

function validateDailyCoreCandidates(input: {
  tradeDate: string;
  prices: DailyRow[];
  adjustments: AdjFactorRow[];
  basics: DailyBasicRow[];
  limits: StkLimitRow[];
  priorMedianDaily: number | null;
}): void {
  if (input.prices.length === 0) {
    throw new Error(`Daily candidate is empty for ${input.tradeDate}`);
  }
  if (
    input.priorMedianDaily != null &&
    input.prices.length < Math.floor(input.priorMedianDaily * 0.7)
  ) {
    throw new Error(
      `Daily candidate has ${input.prices.length} rows for ${input.tradeDate}; recent median is ${input.priorMedianDaily}`,
    );
  }

  const priceCodes = new Set(input.prices.map((row) => row.ts_code));
  assertCodeCoverage(input.tradeDate, 'AdjFactor', priceCodes, input.adjustments, 0.98);
  assertCodeCoverage(input.tradeDate, 'DailyBasic', priceCodes, input.basics, 0.85);
  assertCodeCoverage(input.tradeDate, 'StkLimit', priceCodes, input.limits, 0.85);
}

function assertCodeCoverage<Row extends { ts_code: string }>(
  tradeDate: string,
  table: string,
  expected: Set<string>,
  rows: Row[],
  minimumFraction: number,
): void {
  const covered = new Set(rows.map((row) => row.ts_code));
  let matches = 0;
  for (const code of expected) {
    if (covered.has(code)) {
      matches++;
    }
  }
  const fraction = expected.size > 0 ? matches / expected.size : 0;
  if (fraction < minimumFraction) {
    throw new Error(
      `${table} covers ${(fraction * 100).toFixed(1)}% of Daily codes for ${tradeDate}; minimum is ${(minimumFraction * 100).toFixed(1)}%`,
    );
  }
}

/**
 * Sync "whole-market daily quotes + adjustment factors" day by day, per trading day.
 *
 * One daily(trade_date=X) / adj_factor(trade_date=X) returns all ~5000 instruments for that day,
 * so fetching by day uses orders of magnitude fewer calls than fetching by stock. Each day is
 * written as "deleteMany for the day + createMany", making repeated syncs idempotent (SQLite's
 * createMany doesn't support skipDuplicates, hence delete + create).
 */
export async function syncDaily(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  let dates = await getOpenDates(start, end);
  if (dates.length === 0) {
    await syncTradeCal(client, start, end);
    dates = await getOpenDates(start, end);
  }

  // Resumable: skip trading days already synced within the range (each day is written in a single
  // transaction, so any data for a day means it's considered complete).
  // Rerunning the same range after an interruption only fills the gaps; it can resume even if
  // interrupted again.
  const existing = await prisma.daily.findMany({
    where: { tradeDate: { gte: start, lte: end } },
    distinct: ['tradeDate'],
    select: { tradeDate: true },
  });
  const have = new Set(existing.map((e) => e.tradeDate));
  const todo = dates.filter((d) => !have.has(d));
  log(`syncDaily: 区间 ${dates.length} 开市日，已同步 ${have.size}，待补 ${todo.length}`);

  let done = 0;
  for (const d of todo) {
    const px = await daily(client, { trade_date: d });
    const adj = await adjFactor(client, { trade_date: d });
    await prisma.$transaction([
      prisma.daily.deleteMany({ where: { tradeDate: d } }),
      prisma.daily.createMany({ data: px.map(toDaily) }),
      prisma.adjFactor.deleteMany({ where: { tradeDate: d } }),
      prisma.adjFactor.createMany({
        data: adj.map((r) => ({
          tsCode: canonicalStockCode(r.ts_code),
          tradeDate: r.trade_date,
          adjFactor: r.adj_factor,
        })),
      }),
    ]);
    done++;
    if (done % 10 === 0 || done === todo.length) {
      log(`  ${done}/${todo.length} (${d}) 日线 ${px.length} / 复权 ${adj.length}`);
    }
  }
  log('syncDaily 完成');
}

/**
 * Sync daily valuation metrics (daily_basic) by trading day. Resumable: skips days already present.
 * One call per day returns the whole market (~5000 rows).
 */
export async function syncDailyBasic(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  let dates = await getOpenDates(start, end);
  if (dates.length === 0) {
    await syncTradeCal(client, start, end);
    dates = await getOpenDates(start, end);
  }
  const existing = await prisma.dailyBasic.findMany({
    where: { tradeDate: { gte: start, lte: end }, turnoverRateF: { not: null } },
    distinct: ['tradeDate'],
    select: { tradeDate: true },
  });
  const have = new Set(existing.map((e) => e.tradeDate));
  const todo = dates.filter((d) => !have.has(d));
  log(`syncDailyBasic: 区间 ${dates.length} 开市日，已同步 ${have.size}，待补 ${todo.length}`);

  let done = 0;
  for (const d of todo) {
    const rows = await dailyBasic(client, { trade_date: d });
    await prisma.$transaction([
      prisma.dailyBasic.deleteMany({ where: { tradeDate: d } }),
      prisma.dailyBasic.createMany({
        data: rows.map(toDailyBasic),
      }),
    ]);
    done++;
    if (done % 10 === 0 || done === todo.length) {
      log(`  ${done}/${todo.length} (${d}) 估值 ${rows.length}`);
    }
  }
  log('syncDailyBasic 完成');
}

/**
 * Sync daily price limits (limit-up / limit-down prices) for the range, per trading day (resumable: skips days already
 * loaded). Mirrors syncDailyBasic — per-day deleteMany + createMany keeps repeated syncs idempotent.
 */
export async function syncStkLimit(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  let dates = await getOpenDates(start, end);
  if (dates.length === 0) {
    await syncTradeCal(client, start, end);
    dates = await getOpenDates(start, end);
  }
  const existing = await prisma.stkLimit.findMany({
    where: { tradeDate: { gte: start, lte: end } },
    distinct: ['tradeDate'],
    select: { tradeDate: true },
  });
  const have = new Set(existing.map((e) => e.tradeDate));
  const todo = dates.filter((d) => !have.has(d));
  log(`syncStkLimit: 区间 ${dates.length} 开市日，已同步 ${have.size}，待补 ${todo.length}`);

  let done = 0;
  for (const d of todo) {
    const rows = await stkLimit(client, { trade_date: d });
    await prisma.$transaction([
      prisma.stkLimit.deleteMany({ where: { tradeDate: d } }),
      prisma.stkLimit.createMany({
        data: rows.map(toStkLimit),
      }),
    ]);
    done++;
    if (done % 10 === 0 || done === todo.length) {
      log(`  ${done}/${todo.length} (${d}) 涨跌停 ${rows.length}`);
    }
  }
  log('syncStkLimit 完成');
}

function toDaily(r: DailyRow) {
  return {
    tsCode: canonicalStockCode(r.ts_code),
    tradeDate: r.trade_date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    preClose: r.pre_close,
    pctChg: r.pct_chg,
    vol: r.vol,
    amount: r.amount,
  };
}

function toDailyBasic(row: DailyBasicRow) {
  return {
    tsCode: canonicalStockCode(row.ts_code),
    tradeDate: row.trade_date,
    pe: row.pe,
    peTtm: row.pe_ttm,
    pb: row.pb,
    ps: row.ps,
    psTtm: row.ps_ttm,
    dvRatio: row.dv_ratio,
    dvTtm: row.dv_ttm,
    totalMv: row.total_mv,
    circMv: row.circ_mv,
    turnoverRate: row.turnover_rate,
    turnoverRateF: row.turnover_rate_f,
  };
}

function toStkLimit(row: StkLimitRow) {
  return {
    tsCode: canonicalStockCode(row.ts_code),
    tradeDate: row.trade_date,
    upLimit: row.up_limit,
    downLimit: row.down_limit,
  };
}
