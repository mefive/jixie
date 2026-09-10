import { prisma } from '#infra/database/prisma.js';

export async function latestCompletedTradeDate(): Promise<string | null> {
  const { today, hour } = shanghaiClock();
  const upperBound = hour >= 16 ? today : previousCalendarDate(today);
  const row = await prisma.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lte: upperBound } },
    orderBy: { calDate: 'desc' },
    select: { calDate: true },
  });
  return row?.calDate ?? null;
}

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

function isCompletedShanghaiDate(tradeDate: string): boolean {
  const { today, hour } = shanghaiClock();
  return tradeDate < today || (tradeDate === today && hour >= 16);
}

function shanghaiClock(): { today: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    today: `${value.year}${value.month}${value.day}`,
    hour: Number(value.hour),
  };
}

function previousCalendarDate(date: string): string {
  const utc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)) - 1,
  );
  return new Date(utc).toISOString().slice(0, 10).replaceAll('-', '');
}
