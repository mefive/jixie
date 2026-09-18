import type { Prisma } from '#infra/database/prisma.js';
import { toNumber } from '../quality/format.js';
import type { AuditFinding } from '../quality/report.js';

export interface StockMasterRow {
  listStatus: string;
  count: bigint | number;
}

export interface StockCoverageRow {
  dailyCodes: bigint | number;
  unexplainedOrphanCodes: bigint | number;
  aliasedDailyCodes: bigint | number;
}

export async function auditStockUniverse(database: Prisma): Promise<AuditFinding> {
  const [statusRows, coverageRows] = await Promise.all([
    database.$queryRaw<StockMasterRow[]>`
      SELECT listStatus, COUNT(*) AS count
      FROM StockBasic
      GROUP BY listStatus
      ORDER BY listStatus
    `,
    database.$queryRaw<StockCoverageRow[]>`
      SELECT
        COUNT(DISTINCT d.tsCode) AS dailyCodes,
        COUNT(DISTINCT CASE WHEN b.tsCode IS NULL AND c.oldTsCode IS NULL THEN d.tsCode END)
          AS unexplainedOrphanCodes,
        COUNT(DISTINCT CASE WHEN c.oldTsCode IS NOT NULL THEN d.tsCode END) AS aliasedDailyCodes
      FROM Daily d
      LEFT JOIN StockBasic b ON b.tsCode = d.tsCode
      LEFT JOIN StockCodeChange c ON c.oldTsCode = d.tsCode
    `,
  ]);
  const counts = new Map(statusRows.map((row) => [row.listStatus, toNumber(row.count)]));
  const delistedCount = counts.get('D') ?? 0;
  const unexplainedOrphanCodes = toNumber(coverageRows[0]?.unexplainedOrphanCodes);
  const aliasedDailyCodes = toNumber(coverageRows[0]?.aliasedDailyCodes);
  const dailyCodes = toNumber(coverageRows[0]?.dailyCodes);
  const hasSurvivorshipRisk =
    delistedCount === 0 || unexplainedOrphanCodes > 0 || aliasedDailyCodes > 0;

  return {
    id: 'stock-universe-survivorship',
    title: 'Stock universe: delisted coverage',
    status: hasSurvivorshipRisk ? 'error' : 'pass',
    summary: `${delistedCount} delisted instruments; ${unexplainedOrphanCodes} unexplained and ${aliasedDailyCodes} non-canonical of ${dailyCodes} Daily codes`,
    details: [
      `StockBasic status counts: ${statusRows.map((row) => `${row.listStatus}=${toNumber(row.count)}`).join(', ') || 'empty'}.`,
      ...(delistedCount === 0
        ? [
            'No delisted instruments are retained in StockBasic; a universe built from this table alone has survivorship risk.',
          ]
        : []),
      ...(unexplainedOrphanCodes > 0
        ? [
            `${unexplainedOrphanCodes} historical price codes cannot be explained by StockBasic or StockCodeChange.`,
          ]
        : []),
      ...(aliasedDailyCodes > 0
        ? [
            `${aliasedDailyCodes} superseded codes remain in Daily and can duplicate a security in cross-sectional analysis.`,
          ]
        : []),
    ],
  };
}
