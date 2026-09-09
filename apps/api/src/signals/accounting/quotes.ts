import { prisma } from '../../infra/database/prisma.js';
import type { MarketQuote } from './replay.js';

export async function loadMarketQuotes(
  tradeDate: string,
  codes: string[],
): Promise<Map<string, MarketQuote>> {
  const [stocks, etfs, limits] = await Promise.all([
    prisma.daily.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, open: true, close: true, amount: true },
    }),
    prisma.etfDaily.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, open: true, close: true, amount: true },
    }),
    prisma.stkLimit.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, upLimit: true, downLimit: true },
    }),
  ]);
  const limitByCode = new Map(limits.map((limit) => [limit.tsCode, limit]));
  return new Map(
    [...stocks, ...etfs].map((row) => {
      const limit = limitByCode.get(row.tsCode);
      return [
        row.tsCode,
        {
          open: row.open,
          close: row.close,
          amount: row.amount,
          upLimit: limit?.upLimit ?? null,
          downLimit: limit?.downLimit ?? null,
        },
      ];
    }),
  );
}

export async function nextTradingDate(tradeDate: string): Promise<string | null> {
  const next = await prisma.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: tradeDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return next?.calDate ?? null;
}
