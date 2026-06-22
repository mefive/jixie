import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../tushare/client.js';
import { stockBasic, tradeCal, daily, adjFactor, type DailyRow } from '../tushare/api.js';
import { prisma } from '../lib/prisma.js';
import { log } from '../util/log.js';

/** 同步股票列表（全量覆盖，量小）。 */
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

/** 同步交易日历（区间覆盖）。 */
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

/** 区间内开市日（升序）。 */
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
 * 按交易日逐日同步「全市场日线 + 复权因子」。
 *
 * 一次 daily(trade_date=X) / adj_factor(trade_date=X) 返回当天全部 ~5000 只,
 * 所以按日拉比按股票拉省几个数量级调用次数。每日「先 deleteMany 当日 + createMany」入库,
 * 重复同步幂等(SQLite 的 createMany 不支持 skipDuplicates,故用删+建)。
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
  log(`syncDaily: ${dates.length} 个开市日待同步`);

  let done = 0;
  for (const d of dates) {
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
    if (done % 10 === 0 || done === dates.length) {
      log(`  ${done}/${dates.length} (${d}) 日线 ${px.length} / 复权 ${adj.length}`);
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
