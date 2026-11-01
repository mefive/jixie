import { getDatabase } from '#infra/database/prisma.js';
import { calendarDay } from '../synchronization/date.js';

/**
 * 只使用逐日连续保存的日历定位捕获日后的第一个交易日。
 *
 * Resolve the first session after capture only from a continuously stored calendar.
 */
export async function nextVerifiedSession(
  date: string,
  database: Pick<import('@prisma/client').Prisma.TransactionClient, 'tradeCal'> = getDatabase(),
): Promise<string | null> {
  const next = await database.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: date } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  if (!next) {
    return null;
  }
  const days = await database.tradeCal.count({
    where: { exchange: 'SSE', calDate: { gt: date, lte: next.calDate } },
  });
  let required = 0;
  for (let cursor = calendarDay(date, 1); cursor <= next.calDate; cursor = calendarDay(cursor, 1)) {
    required++;
  }

  return days === required ? next.calDate : null;
}
