import { prisma } from '#infra/database/prisma.js';
import type { TradeDate } from '@jixie/shared';

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

export async function getRecentOpenDates(
  through: string,
  lookbackTradingDays: number,
): Promise<string[]> {
  const rows = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lte: through } },
    orderBy: { calDate: 'desc' },
    take: lookbackTradingDays,
    select: { calDate: true },
  });
  return rows.map((row) => row.calDate).reverse();
}

export async function getOpenDatesAfter(afterDate: string, cutoff: string): Promise<string[]> {
  const rows = await prisma.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gt: afterDate, lte: cutoff },
    },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return rows.map((row) => row.calDate);
}

export async function getExplicitOpenDate(tradeDate: string): Promise<string[]> {
  const row = await prisma.tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
    select: { isOpen: true },
  });
  if (!row || row.isOpen !== 1) {
    return [];
  }
  return [tradeDate];
}

export async function isNextOpenDate(afterDate: string, tradeDate: string): Promise<boolean> {
  const next = await prisma.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: afterDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return next?.calDate === tradeDate;
}
