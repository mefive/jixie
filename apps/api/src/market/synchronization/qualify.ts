import { getDatabase } from '#infra/database/prisma.js';
import { contiguousCoverage } from './coverage.js';
import { DATASET_POLICIES } from './policies.js';
import { stockPartitionCoverage } from '../stocks/sync-partition.js';
import type { MarketPartition, PreparedMarketPartition } from './partition.js';

const SESSION_SERIES = new Set([
  'stock-prices',
  'stock-adjustments',
  'stock-valuations',
  'stock-limits',
  'index-prices',
  'index-valuations',
  'etf-prices',
  'etf-adjustments',
]);

/**
 * 传输终页不代替业务范围证明；缺日仍接纳合法记录，但撤销覆盖和删除授权。
 *
 * A terminal page does not prove business coverage; missing sessions preserve valid records but
 * revoke coverage and deletion authority.
 */
export async function qualifyMarketPartition(
  partition: MarketPartition,
  prepared: PreparedMarketPartition,
): Promise<PreparedMarketPartition> {
  const gaps: string[] = [];
  if (
    SESSION_SERIES.has(partition.dataset) &&
    (prepared.status === 'complete' ||
      (prepared.checks.terminalPage === true &&
        prepared.checks.sourceFailed === false &&
        prepared.checks.invalidRows === 0))
  ) {
    const exchange = 'SSE';
    const calendar = await getDatabase().datasetSyncPartition.findMany({
      where: {
        dataset: 'calendar',
        policyVersion: DATASET_POLICIES.find((policy) => policy.dataset === 'calendar')!.version,
        scope: exchange,
        status: 'complete',
        startDate: { lte: partition.endDate },
        endDate: { gte: partition.startDate },
      },
    });
    if ((contiguousCoverage(partition.startDate, calendar) ?? '') < partition.endDate) {
      gaps.push(`${exchange}: unverified source session calendar`);
    }
    const sessions = await getDatabase().tradeCal.findMany({
      where: { exchange, isOpen: 1, calDate: { gte: partition.startDate, lte: partition.endDate } },
      select: { calDate: true },
    });
    if (!sessions.length && !gaps.length && prepared.checks.emptyResponse === true) {
      prepared.status = 'not_applicable';
      prepared.errors = [];
      prepared.gaps = [];

      return prepared;
    }
    const dates = new Set(
      prepared.tables.flatMap((table) => table.records.map((record) => record.values.tradeDate)),
    );
    for (const session of sessions) {
      if (!dates.has(session.calDate)) {
        gaps.push(
          `${partition.dataset}/${partition.scope}: missing observation ${session.calDate}`,
        );
      }
    }
  }
  if (
    ['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'].includes(
      partition.dataset,
    ) &&
    prepared.checks.terminalPage === true &&
    prepared.checks.sourceFailed === false &&
    prepared.checks.invalidRows === 0 &&
    !prepared.errors.length
  ) {
    gaps.push(...(await stockPartitionCoverage(partition, prepared)));
    if (!gaps.length) {
      prepared.status = 'complete';
      prepared.gaps = [];
      for (const table of prepared.tables) {
        table.replace = true;
      }
    }
  }
  if (gaps.length) {
    prepared.status = 'partial';
    prepared.gaps.push(...gaps);
  }
  for (const table of prepared.tables) {
    table.replace =
      Boolean(table.replace) &&
      ((prepared.status === 'complete' && !prepared.errors.length) ||
        (table.atomic === true && prepared.checks.terminalPage && !prepared.checks.sourceFailed));
  }

  return prepared;
}
