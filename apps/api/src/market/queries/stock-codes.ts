import { prisma } from '../../infra/database/prisma.js';

/** All stock codes that have price data (incl. delisted). GROUP BY must happen in SQLite: Prisma's
 * client-side distinct can materialize the multi-million-row Daily code column in Node. */
export async function stockCodesWithDailyData(): Promise<string[]> {
  const rows = await prisma.daily.groupBy({
    by: ['tsCode'],
    orderBy: { tsCode: 'asc' },
  });
  return rows.map((r) => r.tsCode);
}
