import type { TradeDate } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { log } from '../../infra/logging.js';
import { tradeCal } from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/client.js';

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
export async function getOpenDates(
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
