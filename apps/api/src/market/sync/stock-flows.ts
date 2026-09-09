import type { TradeDate } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { log } from '../../infra/logging.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { moneyflow, topList } from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/client.js';
import { getOpenDates, syncTradeCal } from './calendar.js';

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
