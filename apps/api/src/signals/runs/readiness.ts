import { prisma } from '#infra/database/prisma.js';
import { isCompletedShanghaiDate } from '#market/calendar/sse-close.js';

export async function signalCalendar(
  tradeDate: string,
): Promise<
  { kind: 'ready'; execDate: string } | { kind: 'invalid_date' } | { kind: 'next_date_missing' }
> {
  if (!/^\d{8}$/.test(tradeDate) || !isCompletedShanghaiDate(tradeDate)) {
    return { kind: 'invalid_date' };
  }
  const row = await prisma.tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
  });
  if (!row || row.isOpen !== 1) {
    return { kind: 'invalid_date' };
  }
  const next = await prisma.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: tradeDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return next ? { kind: 'ready', execDate: next.calDate } : { kind: 'next_date_missing' };
}

export async function signalDataReady(tradeDate: string): Promise<boolean> {
  const [daily, adjustment, basic, limits] = await Promise.all([
    prisma.daily.count({ where: { tradeDate } }),
    prisma.adjFactor.count({ where: { tradeDate } }),
    prisma.dailyBasic.count({ where: { tradeDate } }),
    prisma.stkLimit.count({ where: { tradeDate } }),
  ]);
  return daily > 0 && adjustment > 0 && basic > 0 && limits > 0;
}
