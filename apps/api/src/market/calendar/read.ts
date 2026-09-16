import type { TradeDate } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';

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
