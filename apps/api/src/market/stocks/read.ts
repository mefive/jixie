import { prisma } from '#infra/database/prisma.js';

/**
 * 在 SQLite 侧分组读取所有有行情证券，包含退市证券，避免客户端 distinct 的内存开销。
 *
 * All stock codes that have price data (incl. delisted). GROUP BY must happen in SQLite: Prisma's
 * client-side distinct can materialize the multi-million-row Daily code column in Node.
 */
export async function stockCodesWithDailyData(): Promise<string[]> {
  const rows = await prisma.daily.groupBy({
    by: ['tsCode'],
    orderBy: { tsCode: 'asc' },
  });
  return rows.map((r) => r.tsCode);
}
