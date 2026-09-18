import type { Prisma } from '#infra/database/prisma.js';
import { buildDenseCoverageFinding } from '../quality/coverage.js';
import type { AuditFinding } from '../quality/report.js';

export async function auditIndustryCalendarCoverage(
  database: Prisma,
  startDate: string,
  endDate: string,
  openDates: string[],
): Promise<AuditFinding> {
  const rows = await database.swIndexDaily.groupBy({
    by: ['tradeDate'],
    where: { tradeDate: { gte: startDate, lte: endDate } },
    _count: { _all: true },
    orderBy: { tradeDate: 'asc' },
  });
  return buildDenseCoverageFinding(
    'sw-index-daily',
    'SW2021 Level-1 industry bars',
    openDates,
    rows.map((row) => ({ tradeDate: row.tradeDate, count: row._count._all })),
  );
}
