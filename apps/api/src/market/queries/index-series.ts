import { prisma } from '../../infra/database/prisma.js';

export async function loadIndexSeries(tsCode: string, start: string, end: string) {
  const rows = await prisma.indexDaily.findMany({
    where: { tsCode: tsCode, tradeDate: { gte: start, lte: end } },
    select: { tradeDate: true, close: true },
    orderBy: { tradeDate: 'asc' },
  });
  return { points: rows.map((r) => ({ date: r.tradeDate, close: r.close })) };
}
