import { ulid } from 'ulid';
import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../tushare/client.js';
import {
  stockBasic,
  tradeCal,
  daily,
  adjFactor,
  dailyBasic,
  stkLimit,
  moneyflow,
  topList,
  finaIndicator,
  dividend,
  indexWeight,
  indexDaily,
  type DailyRow,
} from '../tushare/api.js';
import { prisma } from '../lib/prisma.js';
import { log } from '../util/log.js';

/** Sync the stock list (full overwrite — small volume). */
export async function syncStockBasic(client: TushareClient): Promise<number> {
  const rows = await stockBasic(client);
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
        listStatus: r.list_status,
      })),
    }),
  ]);
  log(`stock_basic 落库 ${rows.length} 只`);
  return rows.length;
}

/** Sync the trading calendar (range overwrite). */
export async function syncTradeCal(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  const rows = await tradeCal(client, { start_date: start, end_date: end });
  await prisma.$transaction([
    prisma.tradeCal.deleteMany({ where: { calDate: { gte: start, lte: end } } }),
    prisma.tradeCal.createMany({
      data: rows.map((r) => ({
        exchange: r.exchange,
        calDate: r.cal_date,
        isOpen: r.is_open,
        pretradeDate: r.pretrade_date,
      })),
    }),
  ]);
  log(`trade_cal 落库 ${rows.length} 天（${start} ~ ${end}）`);
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
          tsCode: r.ts_code,
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
    where: { tradeDate: { gte: start, lte: end } },
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
        data: rows.map((r) => ({
          tsCode: r.ts_code,
          tradeDate: r.trade_date,
          pe: r.pe,
          peTtm: r.pe_ttm,
          pb: r.pb,
          ps: r.ps,
          psTtm: r.ps_ttm,
          dvRatio: r.dv_ratio,
          dvTtm: r.dv_ttm,
          totalMv: r.total_mv,
          circMv: r.circ_mv,
          turnoverRate: r.turnover_rate,
        })),
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
 * Sync daily price limits (涨/跌停价) for the range, per trading day (resumable: skips days already
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
        data: rows.map((r) => ({
          tsCode: r.ts_code,
          tradeDate: r.trade_date,
          upLimit: r.up_limit,
          downLimit: r.down_limit,
        })),
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
 * Sync 龙虎榜 (Dragon-Tiger List) per trading day into TopList (resumable). A stock can be on multiple
 * 榜单 in a day → multiple rows; we sum net_amount per (code, date) into one row. Per-day deleteMany +
 * createMany keeps it idempotent.
 */
export async function syncTopList(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
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
  const todo = dates.filter((d) => !have.has(d));
  log(`syncTopList: 区间 ${dates.length} 开市日，已同步 ${have.size}，待补 ${todo.length}`);

  let done = 0;
  for (const d of todo) {
    const rows = await topList(client, { trade_date: d });
    const netByCode = new Map<string, number>();
    for (const r of rows) {
      if (r.net_amount == null) {
        continue;
      }
      netByCode.set(r.ts_code, (netByCode.get(r.ts_code) ?? 0) + r.net_amount);
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
 * Sync per-stock daily moneyflow into the Moneyflow table (netMain 主力净额、netTotal 总净额, 万元),
 * per trading day (resumable). Raw fetched point-in-time data: strategies read it via ctx.moneyflow,
 * factor analysis reads the column directly. Idempotent: per-day deleteMany + createMany.
 */
export async function syncMoneyflow(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
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
  const todo = dates.filter((d) => !have.has(d));
  log(`syncMoneyflow: 区间 ${dates.length} 开市日，已同步 ${have.size}，待补 ${todo.length}`);

  let done = 0;
  for (const d of todo) {
    const rows = await moneyflow(client, { trade_date: d });
    const data = rows.map((r) => ({
      tsCode: r.ts_code,
      tradeDate: d,
      // 主力 = (大单+特大单) 买−卖; 总净额 = net_mf_amount(source 可能缺 → null)
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
 * Sync financial indicators (ROE) per stock. One call returns a stock's full period history (with
 * duplicate periods from restatements); we keep the latest annDate per (tsCode, endDate). Resumable:
 * skips stocks already synced. Financial APIs are rate-limited (~80/min), so run with a ≥800ms interval.
 */
export async function syncFinaIndicator(client: TushareClient, codes?: string[]): Promise<void> {
  const all = codes ?? (await getAllStockCodes());
  const existing = await prisma.finaIndicator.findMany({
    distinct: ['tsCode'],
    select: { tsCode: true },
  });
  const have = new Set(existing.map((e) => e.tsCode));
  const todo = all.filter((c) => !have.has(c));
  log(`syncFinaIndicator: 共 ${all.length} 只，已同步 ${have.size}，待补 ${todo.length}`);

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
      tsCode: r.ts_code,
      endDate: r.end_date,
      annDate: r.ann_date,
      roe: r.roe,
      roeWaa: r.roe_waa,
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
export async function syncDividend(client: TushareClient, codes?: string[]): Promise<void> {
  const all = codes ?? (await getAllStockCodes());
  const existing = await prisma.dividend.findMany({
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
      tsCode: r.ts_code,
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
          conCode: r.con_code,
          tradeDate: r.trade_date,
          weight: r.weight,
        })),
      }),
    ]);
    total += rows.length;
  }
  log(`syncIndexWeight 完成，共 ${total} 行`);
}

/** Sync an index's daily close (e.g. 000300.SH) — for benchmark return curves. One call covers the
 * whole range; idempotent (deleteMany the range + createMany). */
export async function syncIndexDaily(
  client: TushareClient,
  indexCode: string,
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  const rows = await indexDaily(client, { ts_code: indexCode, start_date: start, end_date: end });
  await prisma.$transaction([
    prisma.indexDaily.deleteMany({
      where: { tsCode: indexCode, tradeDate: { gte: start, lte: end } },
    }),
    prisma.indexDaily.createMany({
      data: rows.map((r) => ({ tsCode: r.ts_code, tradeDate: r.trade_date, close: r.close })),
    }),
  ]);
  log(`syncIndexDaily ${indexCode}: ${rows.length} 行`);
}

function toDaily(r: DailyRow) {
  return {
    tsCode: r.ts_code,
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
