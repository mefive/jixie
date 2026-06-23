import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../tushare/client.js';
import { stockBasic, tradeCal, daily, adjFactor, type DailyRow } from '../tushare/api.js';
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
