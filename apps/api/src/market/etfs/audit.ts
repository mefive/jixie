import type { Prisma } from '#infra/database/prisma.js';
import { formatNumber } from '../quality/format.js';
import type { AuditFinding } from '../quality/report.js';
import { auditEtfResearchRegistry } from './registry-audit.js';

export async function auditEtfRegistry(database: Prisma, endDate: string): Promise<AuditFinding> {
  const summary = await auditEtfResearchRegistry(database, {
    expectedHistoryStart: '20150101',
    coverageThrough: endDate,
  });
  const dailyRows = summary.rows.reduce((total, row) => total + row.dailyRows, 0);
  const adjustmentRows = summary.rows.reduce((total, row) => total + row.adjustmentRows, 0);
  const shareSizeRows = summary.rows.reduce((total, row) => total + row.shareSizeRows, 0);

  return {
    id: 'etf-research-registry',
    title: 'ETF research registry: metadata and historical coverage',
    status: summary.errors.length > 0 ? 'error' : summary.warnings.length > 0 ? 'warn' : 'pass',
    summary: `${formatNumber(summary.exposures)} exposures / ${formatNumber(summary.products)} products; ${summary.errors.length} errors / ${summary.warnings.length} source warnings`,
    details: [
      `Registry v${summary.registryVersion}, selected ${summary.selectionAsOf}; audited ${summary.expectedHistoryStart}..${summary.coverageThrough}.`,
      `${formatNumber(dailyRows)} daily bars; ${formatNumber(adjustmentRows)} adjustment factors; ${formatNumber(shareSizeRows)} share-size observations.`,
      ...summary.errors.slice(0, 20).map((error) => `Error: ${error}.`),
      ...summary.warnings.slice(0, 20).map((warning) => `Warning: ${warning}.`),
      ...(summary.errors.length + summary.warnings.length > 20
        ? ['Additional registry findings are available from pnpm --filter api audit:etf.']
        : []),
      'Share-size source gaps are preserved as missing observations; no backward fill or same-day look-ahead is allowed.',
    ],
  };
}
