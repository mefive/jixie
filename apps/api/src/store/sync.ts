import { ulid } from 'ulid';
import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../tushare/client.js';
import {
  stockBasic,
  nameChange,
  tradeCal,
  daily,
  adjFactor,
  etfBasic,
  fundBasic,
  fundDaily,
  fundAdj,
  dailyBasic,
  stkLimit,
  moneyflow,
  topList,
  finaIndicator,
  dividend,
  indexWeight,
  indexDaily,
  indexDailyBasic,
  indexClassify,
  indexMemberAll,
  futureContracts,
  futureDaily,
  futureMapping,
  futureSettlement,
  type AdjFactorRow,
  type DailyBasicRow,
  type DailyRow,
  type NameChangeRow,
  type StkLimitRow,
} from '../tushare/api.js';
import { prisma } from '../lib/prisma.js';
import { day, daysBetween } from '../lib/date.js';
import {
  STOCK_CODE_CHANGES,
  canonicalStockCode,
  normalizeStockNameSpells,
} from '../market/stock-identity.js';
import { log } from '../util/log.js';

const STOCK_LIST_STATUSES = ['L', 'D', 'P', 'G'] as const;
const TUSHARE_NAME_CHANGE_ROW_LIMIT = 10_000;

/** Sync the complete stock master. All upstream calls finish before the atomic replacement starts. */
export async function syncStockBasic(client: TushareClient): Promise<number> {
  const batches = await Promise.all(
    STOCK_LIST_STATUSES.map((listStatus) => stockBasic(client, { list_status: listStatus })),
  );
  const byCode = new Map(batches.flat().map((row) => [row.ts_code, row]));
  const rows = [...byCode.values()];

  await prisma.$transaction([
    prisma.stockBasic.deleteMany({}),
    prisma.stockBasic.createMany({
      data: rows.map((r) => ({
        tsCode: r.ts_code,
        symbol: r.symbol,
        name: r.name,
        area: r.area,
        industry: r.industry,
        market: r.market,
        listDate: r.list_date,
        delistDate: r.delist_date,
        listStatus: r.list_status,
      })),
    }),
  ]);
  log(
    `stock_basic stored ${rows.length} instruments (${STOCK_LIST_STATUSES.map(
      (status, index) => `${status}=${batches[index].length}`,
    ).join(', ')})`,
  );
  return rows.length;
}

/** Seed the small, exchange-confirmed code-succession registry idempotently. */
export async function seedStockCodeChanges(): Promise<number> {
  await prisma.$transaction(
    STOCK_CODE_CHANGES.map((change) =>
      prisma.stockCodeChange.upsert({
        where: { oldTsCode: change.oldTsCode },
        create: change,
        update: {
          newTsCode: change.newTsCode,
          effectiveDate: change.effectiveDate,
          source: change.source,
        },
      }),
    ),
  );
  return STOCK_CODE_CHANGES.length;
}

async function fetchNameChangeRange(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<NameChangeRow[]> {
  const rows = await nameChange(client, { start_date: start, end_date: end });
  if (rows.length < TUSHARE_NAME_CHANGE_ROW_LIMIT) {
    return rows;
  }
  if (start === end) {
    throw new Error(`namechange row limit reached for one day: ${start}`);
  }

  const middle = day(start)
    .add(Math.floor(daysBetween(start, end) / 2), 'day')
    .format('YYYYMMDD') as TradeDate;
  const next = day(middle).add(1, 'day').format('YYYYMMDD') as TradeDate;
  const [left, right] = await Promise.all([
    fetchNameChangeRange(client, start, middle),
    fetchNameChangeRange(client, next, end),
  ]);
  return left.concat(right);
}

/** Replace the small point-in-time name-spell table after a complete segmented upstream fetch. */
export async function syncStockNameHistory(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  const rows = await fetchNameChangeRange(client, start, end);
  const fetchedSpells = rows.map((row) => ({
    tsCode: canonicalStockCode(row.ts_code),
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    announcementDate: row.ann_date,
    changeReason: row.change_reason,
  }));
  const data = normalizeStockNameSpells(fetchedSpells);
  const currentStocks = await prisma.stockBasic.findMany({
    where: { listStatus: 'L' },
    select: { tsCode: true, name: true, listDate: true },
  });
  const spellsByCode = new Map<string, typeof data>();
  for (const spell of data) {
    const existing = spellsByCode.get(spell.tsCode);
    if (existing) {
      existing.push(spell);
    } else {
      spellsByCode.set(spell.tsCode, [spell]);
    }
  }
  for (const stock of currentStocks) {
    const tsCode = canonicalStockCode(stock.tsCode);
    const spells = spellsByCode.get(tsCode) ?? [];
    if (spells.some((spell) => spell.endDate === null)) {
      continue;
    }
    const latest = [...spells].sort((left, right) =>
      right.startDate.localeCompare(left.startDate),
    )[0];
    const startDate =
      latest?.endDate != null
        ? (day(latest.endDate).add(1, 'day').format('YYYYMMDD') as TradeDate)
        : (stock.listDate ?? start);
    const fallback = {
      tsCode,
      name: stock.name,
      startDate,
      endDate: null,
      announcementDate: null,
      changeReason: 'StockBasic current-name fallback',
    };
    data.push(fallback);
    spells.push(fallback);
    spellsByCode.set(tsCode, spells);
  }

  await prisma.$transaction([
    prisma.stockNameHistory.deleteMany({}),
    prisma.stockNameHistory.createMany({ data }),
  ]);
  log(`stock name history stored ${data.length} spells`);
  return data.length;
}

function supportsSameDayTurnover(row: {
  name: string;
  fundType: string | null;
  etfType: string | null;
}): boolean {
  if (row.etfType === 'QDII' || row.fundType === '债券型' || row.fundType === '货币型') {
    return true;
  }
  return /黄金|商品期货/.test(row.name);
}

/** Refresh ETF metadata across listed, pending, and delisted statuses. */
export async function syncEtfBasic(client: TushareClient): Promise<number> {
  const [etfRows, fundRows] = await Promise.all([etfBasic(client), fundBasic(client)]);
  const fundByCode = new Map(fundRows.map((row) => [row.ts_code, row]));
  const data = etfRows.map((row) => {
    const fund = fundByCode.get(row.ts_code);
    const name = row.extname || row.csname || fund?.name || row.ts_code;
    const fundType = fund?.fund_type ?? null;
    const etfType = row.etf_type ?? null;

    return {
      tsCode: row.ts_code,
      name,
      fullName: row.cname,
      indexCode: row.index_code,
      indexName: row.index_name,
      setupDate: row.setup_date,
      listDate: row.list_date,
      delistDate: fund?.delist_date ?? null,
      listStatus: row.list_status,
      exchange: row.exchange,
      managerName: row.mgr_name,
      custodianName: row.custod_name,
      managementFee: row.mgt_fee,
      fundType,
      etfType,
      sameDayTurnover: supportsSameDayTurnover({ name, fundType, etfType }),
      lotSize: 100,
    };
  });

  await prisma.$transaction([prisma.etfBasic.deleteMany({}), prisma.etfBasic.createMany({ data })]);
  log(`etf_basic stored ${data.length} instruments (all listing statuses)`);
  return data.length;
}

interface DateSlice {
  start: TradeDate;
  end: TradeDate;
}

function yearlySlices(start: TradeDate, end: TradeDate): DateSlice[] {
  const slices: DateSlice[] = [];
  for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
    slices.push({
      start: (year === Number(start.slice(0, 4)) ? start : `${year}0101`) as TradeDate,
      end: (year === Number(end.slice(0, 4)) ? end : `${year}1231`) as TradeDate,
    });
  }
  return slices;
}

/**
 * Sync selected ETF daily bars and adjustment factors in atomic code/year slices.
 * Completion markers make a long backfill resumable; pass refresh to refetch completed slices.
 */
export async function syncEtfDaily(
  client: TushareClient,
  codes: string[],
  start: TradeDate,
  end: TradeDate,
  options: { refresh?: boolean } = {},
): Promise<{ daily: number; adj: number; skippedSlices: number }> {
  const uniqueCodes = [...new Set(codes)].sort();
  const known = await prisma.etfBasic.findMany({
    where: { tsCode: { in: uniqueCodes } },
    select: { tsCode: true },
  });
  const knownCodes = new Set(known.map((row) => row.tsCode));
  const unknownCodes = uniqueCodes.filter((code) => !knownCodes.has(code));
  if (unknownCodes.length > 0) {
    throw new Error(`Unknown ETF code(s): ${unknownCodes.join(', ')}`);
  }

  let dailyCount = 0;
  let adjCount = 0;
  let skippedSlices = 0;
  const slices = yearlySlices(start, end);

  for (const code of uniqueCodes) {
    for (const slice of slices) {
      if (!options.refresh) {
        const completed = await prisma.etfSyncSlice.findUnique({
          where: {
            tsCode_startDate_endDate: {
              tsCode: code,
              startDate: slice.start,
              endDate: slice.end,
            },
          },
          select: { tsCode: true },
        });
        if (completed) {
          skippedSlices++;
          continue;
        }
      }

      const [dailyRows, adjRows] = await Promise.all([
        fundDaily(client, {
          ts_code: code,
          start_date: slice.start,
          end_date: slice.end,
        }),
        fundAdj(client, {
          ts_code: code,
          start_date: slice.start,
          end_date: slice.end,
        }),
      ]);
      await prisma.$transaction([
        prisma.etfDaily.deleteMany({
          where: { tsCode: code, tradeDate: { gte: slice.start, lte: slice.end } },
        }),
        prisma.etfDaily.createMany({
          data: dailyRows.map((row) => ({
            tsCode: row.ts_code,
            tradeDate: row.trade_date,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            preClose: row.pre_close,
            pctChg: row.pct_chg,
            vol: row.vol,
            amount: row.amount,
          })),
        }),
        prisma.etfAdjFactor.deleteMany({
          where: { tsCode: code, tradeDate: { gte: slice.start, lte: slice.end } },
        }),
        prisma.etfAdjFactor.createMany({
          data: adjRows.map((row) => ({
            tsCode: row.ts_code,
            tradeDate: row.trade_date,
            adjFactor: row.adj_factor,
          })),
        }),
        prisma.etfSyncSlice.upsert({
          where: {
            tsCode_startDate_endDate: {
              tsCode: code,
              startDate: slice.start,
              endDate: slice.end,
            },
          },
          create: { tsCode: code, startDate: slice.start, endDate: slice.end },
          update: { completedAt: new Date() },
        }),
      ]);
      dailyCount += dailyRows.length;
      adjCount += adjRows.length;
      log(
        `  ${code} ${slice.start}~${slice.end}: daily ${dailyRows.length}, adj ${adjRows.length}`,
      );
    }
  }

  log(
    `syncEtfDaily complete: daily ${dailyCount}, adj ${adjCount}, skipped slices ${skippedSlices}`,
  );
  return { daily: dailyCount, adj: adjCount, skippedSlices };
}

/** Sync the trading calendar (range overwrite). */
export async function syncTradeCal(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
  exchange = 'SSE',
): Promise<number> {
  const rows = await tradeCal(client, { exchange, start_date: start, end_date: end });
  await prisma.$transaction([
    prisma.tradeCal.deleteMany({ where: { exchange, calDate: { gte: start, lte: end } } }),
    prisma.tradeCal.createMany({
      data: rows.map((r) => ({
        exchange: r.exchange,
        calDate: r.cal_date,
        isOpen: r.is_open,
        pretradeDate: r.pretrade_date,
      })),
    }),
  ]);
  log(`trade_cal ${exchange} 落库 ${rows.length} 天（${start} ~ ${end}）`);
  return rows.length;
}

/** Open trading days within the range (ascending). */
async function getOpenDates(
  start: TradeDate,
  end: TradeDate,
  exchange = 'SSE',
): Promise<TradeDate[]> {
  const rows = await prisma.tradeCal.findMany({
    where: { exchange, isOpen: 1, calDate: { gte: start, lte: end } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return rows.map((r) => r.calDate);
}

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

/**
 * Sync the Dragon-Tiger List per trading day into TopList (resumable). A stock can be on multiple
 * lists in a day → multiple rows; we sum net_amount per (code, date) into one row. Per-day deleteMany +
 * createMany keeps it idempotent.
 */
export async function syncTopList(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
  options: { refresh?: boolean } = {},
): Promise<void> {
  let dates = await getOpenDates(start, end);
  if (dates.length === 0) {
    await syncTradeCal(client, start, end);
    dates = await getOpenDates(start, end);
  }
  // No per-day marker table (TopList only has rows for listed stocks), so resume off distinct dates seen.
  const existing = await prisma.topList.findMany({
    where: { tradeDate: { gte: start, lte: end } },
    distinct: ['tradeDate'],
    select: { tradeDate: true },
  });
  const have = new Set(existing.map((e) => e.tradeDate));
  const todo = options.refresh ? dates : dates.filter((d) => !have.has(d));
  log(`syncTopList: 区间 ${dates.length} 开市日，已同步 ${have.size}，待补 ${todo.length}`);

  let done = 0;
  for (const d of todo) {
    const rows = await topList(client, { trade_date: d });
    const netByCode = new Map<string, number>();
    for (const r of rows) {
      if (r.net_amount == null) {
        continue;
      }
      const tsCode = canonicalStockCode(r.ts_code);
      netByCode.set(tsCode, (netByCode.get(tsCode) ?? 0) + r.net_amount);
    }
    await prisma.$transaction([
      prisma.topList.deleteMany({ where: { tradeDate: d } }),
      prisma.topList.createMany({
        data: [...netByCode].map(([tsCode, netAmount]) => ({ tsCode, tradeDate: d, netAmount })),
      }),
    ]);
    done++;
    if (done % 20 === 0 || done === todo.length) {
      log(`  ${done}/${todo.length} (${d}) 龙虎榜 ${netByCode.size}`);
    }
  }
  log('syncTopList 完成');
}

/** Moneyflow-derived factor keys (values come from the Moneyflow table) — surfaced in factor analysis. */
export const MF_FACTORS = ['mf_net_main', 'mf_net_total'] as const;

/**
 * Sync per-stock daily moneyflow into the Moneyflow table (netMain = net main-force amount, netTotal = net total amount, in 10k CNY),
 * per trading day (resumable). Raw fetched point-in-time data: strategies read it via ctx.moneyflow,
 * factor analysis reads the column directly. Idempotent: per-day deleteMany + createMany.
 */
export async function syncMoneyflow(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
  options: { refresh?: boolean } = {},
): Promise<void> {
  let dates = await getOpenDates(start, end);
  if (dates.length === 0) {
    await syncTradeCal(client, start, end);
    dates = await getOpenDates(start, end);
  }
  const existing = await prisma.moneyflow.findMany({
    where: { tradeDate: { gte: start, lte: end } },
    distinct: ['tradeDate'],
    select: { tradeDate: true },
  });
  const have = new Set(existing.map((e) => e.tradeDate));
  const todo = options.refresh ? dates : dates.filter((d) => !have.has(d));
  log(`syncMoneyflow: 区间 ${dates.length} 开市日，已同步 ${have.size}，待补 ${todo.length}`);

  let done = 0;
  for (const d of todo) {
    const rows = await moneyflow(client, { trade_date: d });
    const data = rows.map((r) => ({
      tsCode: canonicalStockCode(r.ts_code),
      tradeDate: d,
      // main-force = (large + extra-large orders) buy − sell; net total = net_mf_amount (source may be missing → null)
      netMain:
        (r.buy_lg_amount ?? 0) +
        (r.buy_elg_amount ?? 0) -
        (r.sell_lg_amount ?? 0) -
        (r.sell_elg_amount ?? 0),
      netTotal: r.net_mf_amount ?? null,
    }));
    await prisma.$transaction([
      prisma.moneyflow.deleteMany({ where: { tradeDate: d } }),
      prisma.moneyflow.createMany({ data }),
    ]);
    done++;
    if (done % 10 === 0 || done === todo.length) {
      log(`  ${done}/${todo.length} (${d}) 资金流 ${rows.length}`);
    }
  }
  log('syncMoneyflow 完成');
}

/** All stock codes that have price data (incl. delisted), the universe for per-stock financial sync. */
async function getAllStockCodes(): Promise<string[]> {
  const rows = await prisma.daily.findMany({
    distinct: ['tsCode'],
    select: { tsCode: true },
    orderBy: { tsCode: 'asc' },
  });
  return rows.map((r) => r.tsCode);
}

/**
 * Sync financial indicators per stock. One call returns a stock's full period history (with
 * duplicate periods from restatements); we keep the latest annDate per (tsCode, endDate). Resumable:
 * skips stocks already synced. Financial APIs are rate-limited (~80/min), so run with a ≥800ms interval.
 * `refresh` re-pulls stocks synced before the 2026-07 column expansion (their new columns are all
 * NULL) — "already backfilled" is detected via a non-null debtToAssets on any period, which is a
 * near-universal field, so an interrupted refresh resumes instead of restarting.
 */
export async function syncFinaIndicator(
  client: TushareClient,
  codes?: string[],
  opts: { refresh?: boolean; forceAll?: boolean } = {},
): Promise<void> {
  const all = codes ?? (await getAllStockCodes());
  const existing = opts.forceAll
    ? []
    : await prisma.finaIndicator.findMany({
        ...(opts.refresh ? { where: { debtToAssets: { not: null } } } : {}),
        distinct: ['tsCode'],
        select: { tsCode: true },
      });
  const have = new Set(existing.map((e) => e.tsCode));
  const todo = all.filter((c) => !have.has(c));
  log(
    `syncFinaIndicator${opts.forceAll ? '(全量刷新)' : opts.refresh ? '(扩列回填)' : ''}: 共 ${all.length} 只，已同步 ${have.size}，待补 ${todo.length}`,
  );

  let done = 0;
  for (const code of todo) {
    const rows = await finaIndicator(client, { ts_code: code });
    // Dedup by period, keeping the latest announcement (restatements supersede earlier figures).
    const byPeriod = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const prev = byPeriod.get(r.end_date);
      if (!prev || (r.ann_date ?? '') > (prev.ann_date ?? '')) {
        byPeriod.set(r.end_date, r);
      }
    }
    const data = [...byPeriod.values()].map((r) => ({
      tsCode: canonicalStockCode(r.ts_code),
      endDate: r.end_date,
      annDate: r.ann_date,
      roe: r.roe,
      roeWaa: r.roe_waa,
      roa: r.roa,
      grossprofitMargin: r.grossprofit_margin,
      netprofitMargin: r.netprofit_margin,
      debtToAssets: r.debt_to_assets,
      orYoy: r.or_yoy,
      netprofitYoy: r.netprofit_yoy,
      ocfToProfit: r.ocf_to_profit,
    }));
    await prisma.$transaction([
      prisma.finaIndicator.deleteMany({ where: { tsCode: code } }),
      prisma.finaIndicator.createMany({ data }),
    ]);
    done++;
    if (done % 100 === 0 || done === todo.length) {
      log(`  fina ${done}/${todo.length} (${code}) ${data.length} 期`);
    }
  }
  log('syncFinaIndicator 完成');
}

/**
 * Sync dividend distributions per stock (raw rows across proposal→execution stages). Resumable:
 * skips stocks already synced. Same financial rate limit applies.
 */
export async function syncDividend(
  client: TushareClient,
  codes?: string[],
  options: { forceAll?: boolean } = {},
): Promise<void> {
  const all = codes ?? (await getAllStockCodes());
  const existing = options.forceAll
    ? []
    : await prisma.dividend.findMany({
        distinct: ['tsCode'],
        select: { tsCode: true },
      });
  const have = new Set(existing.map((e) => e.tsCode));
  const todo = all.filter((c) => !have.has(c));
  log(`syncDividend: 共 ${all.length} 只，已同步 ${have.size}，待补 ${todo.length}`);

  let done = 0;
  for (const code of todo) {
    const rows = await dividend(client, { ts_code: code });
    const data = rows.map((r) => ({
      id: ulid(),
      tsCode: canonicalStockCode(r.ts_code),
      endDate: r.end_date,
      annDate: r.ann_date,
      exDate: r.ex_date,
      divProc: r.div_proc,
      cashDiv: r.cash_div,
      cashDivTax: r.cash_div_tax,
    }));
    await prisma.$transaction([
      prisma.dividend.deleteMany({ where: { tsCode: code } }),
      prisma.dividend.createMany({ data }),
    ]);
    done++;
    if (done % 100 === 0 || done === todo.length) {
      log(`  divi ${done}/${todo.length} (${code}) ${data.length} 行`);
    }
  }
  log('syncDividend 完成');
}

/**
 * Sync an index's monthly constituents (index_weight) over a date range. Fetched quarter by quarter
 * to stay under the per-call row cap; each quarter is written as deleteMany + createMany (idempotent,
 * resumable on rerun). E.g. CSI 1000 = 000852.SH.
 */
export async function syncIndexWeight(
  client: TushareClient,
  indexCode: string,
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  const startYear = +start.slice(0, 4);
  const endYear = +end.slice(0, 4);
  const quarters: [string, string][] = [];
  for (let y = startYear; y <= endYear; y++) {
    quarters.push([`${y}0101`, `${y}0331`], [`${y}0401`, `${y}0630`]);
    quarters.push([`${y}0701`, `${y}0930`], [`${y}1001`, `${y}1231`]);
  }
  log(`syncIndexWeight ${indexCode}: ${quarters.length} 个季度区间`);

  let total = 0;
  for (const [qs, qe] of quarters) {
    const s = qs < start ? start : qs;
    const e = qe > end ? end : qe;
    if (s > e) {
      continue;
    }
    const rows = await indexWeight(client, { index_code: indexCode, start_date: s, end_date: e });
    await prisma.$transaction([
      prisma.indexWeight.deleteMany({
        where: { indexCode, tradeDate: { gte: s, lte: e } },
      }),
      prisma.indexWeight.createMany({
        data: rows.map((r) => ({
          indexCode: r.index_code,
          conCode: canonicalStockCode(r.con_code),
          tradeDate: r.trade_date,
          weight: r.weight,
        })),
      }),
    ]);
    total += rows.length;
  }
  log(`syncIndexWeight 完成，共 ${total} 行`);
}

/**
 * Sync Shenwan (SW2021) level-1 industry membership — the point-in-time (stock → industry) map used
 * for industry-neutralization in factor analysis. Fetches the 31 level-1 industries, then for each
 * pulls current ('Y') + historical ('N') members and unions them so every membership spell (with its
 * in/out dates) is captured. Full overwrite — small volume (~tens of thousands of rows total).
 */
export async function syncSwIndustry(client: TushareClient): Promise<number> {
  const industries = await indexClassify(client, { level: 'L1', src: 'SW2021' });
  log(`syncSwIndustry: ${industries.length} 个申万一级行业`);

  // De-dup by (tsCode, l1Code, inDate) — the 'Y' and 'N' fetches can both return a current spell.
  const seen = new Set<string>();
  const rows: {
    tsCode: string;
    l1Code: string;
    l1Name: string;
    inDate: string;
    outDate: string | null;
  }[] = [];
  for (const industry of industries) {
    for (const isNew of ['Y', 'N']) {
      const members = await indexMemberAll(client, { l1_code: industry.index_code, is_new: isNew });
      for (const member of members) {
        const tsCode = canonicalStockCode(member.ts_code);
        const key = `${tsCode}|${member.l1_code}|${member.in_date}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        rows.push({
          tsCode,
          l1Code: member.l1_code,
          l1Name: member.l1_name,
          inDate: member.in_date,
          outDate: member.out_date,
        });
      }
    }
    log(`  ${industry.industry_name}: 累计 ${rows.length} 行`);
  }

  await prisma.$transaction([
    prisma.swIndustryMember.deleteMany({}),
    prisma.swIndustryMember.createMany({ data: rows }),
  ]);
  log(`syncSwIndustry 完成，共 ${rows.length} 行`);
  return rows.length;
}

/** Sync an index's daily close (e.g. 000300.SH) — for benchmark return curves. The upstream endpoint
 * truncates large responses, so the requested range is fetched in ten-year windows. */
export async function syncIndexDaily(
  client: TushareClient,
  indexCode: string,
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  let total = 0;

  for (let windowStartYear = startYear; windowStartYear <= endYear; windowStartYear += 10) {
    const windowEndYear = Math.min(windowStartYear + 9, endYear);
    const windowStart = `${windowStartYear}0101` < start ? start : `${windowStartYear}0101`;
    const windowEnd = `${windowEndYear}1231` > end ? end : `${windowEndYear}1231`;
    const rows = await indexDaily(client, {
      ts_code: indexCode,
      start_date: windowStart,
      end_date: windowEnd,
    });

    await prisma.$transaction([
      prisma.indexDaily.deleteMany({
        where: { tsCode: indexCode, tradeDate: { gte: windowStart, lte: windowEnd } },
      }),
      prisma.indexDaily.createMany({
        data: rows.map((row) => ({
          tsCode: row.ts_code,
          tradeDate: row.trade_date,
          close: row.close,
        })),
      }),
    ]);
    total += rows.length;
  }

  log(`syncIndexDaily ${indexCode}: ${total} 行`);
}

/** Sync provider-computed daily valuation metrics for broad-market indices. The upstream endpoint has
 * a 3,000-row response cap, so each code is fetched in ten-year windows. */
export async function syncIndexDailyBasic(
  client: TushareClient,
  indexCodes: string[],
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));

  for (const indexCode of indexCodes) {
    let total = 0;
    for (let windowStartYear = startYear; windowStartYear <= endYear; windowStartYear += 10) {
      const windowEndYear = Math.min(windowStartYear + 9, endYear);
      const windowStart = `${windowStartYear}0101` < start ? start : `${windowStartYear}0101`;
      const windowEnd = `${windowEndYear}1231` > end ? end : `${windowEndYear}1231`;
      const rows = await indexDailyBasic(client, {
        ts_code: indexCode,
        start_date: windowStart,
        end_date: windowEnd,
      });
      await prisma.$transaction([
        prisma.indexDailyBasic.deleteMany({
          where: {
            tsCode: indexCode,
            tradeDate: { gte: windowStart, lte: windowEnd },
          },
        }),
        prisma.indexDailyBasic.createMany({
          data: rows.map((row) => ({
            tsCode: row.ts_code,
            tradeDate: row.trade_date,
            totalMv: row.total_mv,
            floatMv: row.float_mv,
            totalShare: row.total_share,
            floatShare: row.float_share,
            freeShare: row.free_share,
            turnoverRate: row.turnover_rate,
            turnoverRateF: row.turnover_rate_f,
            pe: row.pe,
            peTtm: row.pe_ttm,
            pb: row.pb,
          })),
        }),
      ]);
      total += rows.length;
      log(`  syncIndexDailyBasic ${indexCode} ${windowStart}~${windowEnd}: ${rows.length} 行`);
    }
    log(`syncIndexDailyBasic ${indexCode} 完成，共 ${total} 行`);
  }
}

const STOCK_INDEX_FUTURE_PRODUCTS = new Set(['IF', 'IH', 'IC', 'IM']);
const STOCK_INDEX_FUTURE_CONTINUOUS_CODES = ['IF.CFX', 'IH.CFX', 'IC.CFX', 'IM.CFX'];

function isStockIndexFuture(productCode: string): boolean {
  return STOCK_INDEX_FUTURE_PRODUCTS.has(productCode.toUpperCase());
}

/** Refresh the complete metadata list of actual CFFEX stock-index futures contracts. */
export async function syncFutureContracts(client: TushareClient): Promise<number> {
  const rows = (await futureContracts(client, { exchange: 'CFFEX', fut_type: '1' })).filter((row) =>
    isStockIndexFuture(row.fut_code),
  );

  await prisma.$transaction([
    prisma.futureContract.deleteMany({}),
    prisma.futureContract.createMany({
      data: rows.map((row) => ({
        tsCode: row.ts_code,
        symbol: row.symbol,
        productCode: row.fut_code.toUpperCase(),
        name: row.name,
        exchange: row.exchange,
        multiplier: row.multiplier,
        tradeUnit: row.trade_unit,
        perUnit: row.per_unit,
        quoteUnit: row.quote_unit,
        quoteUnitDesc: row.quote_unit_desc,
        deliveryMode: row.d_mode_desc,
        listDate: row.list_date,
        delistDate: row.delist_date,
        deliveryMonth: row.d_month,
        lastDeliveryDate: row.last_ddate,
        tradeTimeDesc: row.trade_time_desc,
      })),
    }),
  ]);
  log(`syncFutureContracts: ${rows.length} 个 IF/IH/IC/IM 月合约`);
  return rows.length;
}

/** Sync actual-contract daily bars. Fetching by contract keeps a full-history load to a few hundred
 * calls instead of one call per trading day across the whole CFFEX market. */
export async function syncFutureDaily(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  const contracts = await overlappingFutureContracts(start, end);
  let totalRows = 0;

  for (const [index, contract] of contracts.entries()) {
    const rangeStart = contract.listDate > start ? contract.listDate : start;
    const rangeEnd = contract.delistDate < end ? contract.delistDate : end;
    const rows = await futureDaily(client, {
      ts_code: contract.tsCode,
      start_date: rangeStart,
      end_date: rangeEnd,
    });
    await prisma.$transaction([
      prisma.futureDaily.deleteMany({
        where: { tsCode: contract.tsCode, tradeDate: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.futureDaily.createMany({
        data: rows.map((row) => ({
          tsCode: row.ts_code,
          tradeDate: row.trade_date,
          preClose: row.pre_close,
          preSettle: row.pre_settle,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          settle: row.settle,
          changeClose: row.change1,
          changeSettle: row.change2,
          volume: row.vol,
          amount: row.amount,
          openInterest: row.oi,
          openInterestChange: row.oi_chg,
          deliverySettle: row.delv_settle,
        })),
      }),
    ]);
    totalRows += rows.length;
    if ((index + 1) % 20 === 0 || index + 1 === contracts.length) {
      log(`syncFutureDaily: ${index + 1}/${contracts.length} 合约，累计 ${totalRows} 行`);
    }
  }
  return totalRows;
}

/** Sync vendor main-contract mappings for all four stock-index futures products. */
export async function syncFutureMappings(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  let totalRows = 0;

  for (const continuousCode of STOCK_INDEX_FUTURE_CONTINUOUS_CODES) {
    const rows = await futureMapping(client, {
      ts_code: continuousCode,
      start_date: start,
      end_date: end,
    });
    await prisma.$transaction([
      prisma.futureMapping.deleteMany({
        where: { continuousCode, tradeDate: { gte: start, lte: end } },
      }),
      prisma.futureMapping.createMany({
        data: rows.map((row) => ({
          continuousCode: row.ts_code,
          tradeDate: row.trade_date,
          mappedTsCode: row.mapping_ts_code,
        })),
      }),
    ]);
    totalRows += rows.length;
    log(`syncFutureMappings ${continuousCode}: ${rows.length} 行`);
  }
  return totalRows;
}

/** Sync historical exchange fee and margin parameters for actual contracts. */
export async function syncFutureSettlements(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  const contracts = await overlappingFutureContracts(start, end);
  let totalRows = 0;

  for (const [index, contract] of contracts.entries()) {
    const rangeStart = contract.listDate > start ? contract.listDate : start;
    const rangeEnd = contract.delistDate < end ? contract.delistDate : end;
    const rows = await futureSettlement(client, {
      ts_code: contract.tsCode,
      start_date: rangeStart,
      end_date: rangeEnd,
    });
    await prisma.$transaction([
      prisma.futureSettlement.deleteMany({
        where: { tsCode: contract.tsCode, tradeDate: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.futureSettlement.createMany({
        data: rows.map((row) => ({
          tsCode: row.ts_code,
          tradeDate: row.trade_date,
          settle: row.settle,
          tradingFeeRate: row.trading_fee_rate,
          tradingFee: row.trading_fee,
          deliveryFee: row.delivery_fee,
          buyHedgeMarginRate: row.b_hedging_margin_rate,
          sellHedgeMarginRate: row.s_hedging_margin_rate,
          longMarginRate: row.long_margin_rate,
          shortMarginRate: row.short_margin_rate,
          closeTodayFee: row.offset_today_fee,
          exchange: row.exchange,
        })),
      }),
    ]);
    totalRows += rows.length;
    if ((index + 1) % 20 === 0 || index + 1 === contracts.length) {
      log(`syncFutureSettlements: ${index + 1}/${contracts.length} 合约，累计 ${totalRows} 行`);
    }
  }
  return totalRows;
}

async function overlappingFutureContracts(start: TradeDate, end: TradeDate) {
  const contracts = await prisma.futureContract.findMany({
    where: { listDate: { lte: end }, delistDate: { gte: start } },
    orderBy: [{ productCode: 'asc' }, { listDate: 'asc' }],
    select: { tsCode: true, listDate: true, delistDate: true },
  });
  if (contracts.length === 0) {
    throw new Error('No stock-index futures contracts found. Run syncFutureContracts first.');
  }
  return contracts;
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
