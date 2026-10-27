import { getDatabase } from '#infra/database/prisma.js';
import { contiguousCoverage } from './coverage.js';
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
  'future-prices',
  'future-mappings',
  'future-settlements',
  'commodity-prices',
  'commodity-mappings',
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
      (prepared.evidence.terminalPage === true &&
        prepared.evidence.sourceFailed === false &&
        prepared.evidence.invalidRows === 0))
  ) {
    const contract =
      partition.dataset.includes('future') || partition.dataset.includes('commodity')
        ? await getDatabase().futureContract.findUnique({
            where: { tsCode: partition.scope },
            select: { exchange: true },
          })
        : null;
    const exchange =
      contract?.exchange ??
      (partition.scope.endsWith('.CFX')
        ? 'CFFEX'
        : partition.scope.endsWith('.SHF')
          ? 'SHFE'
          : partition.scope.endsWith('.INE')
            ? 'INE'
            : partition.scope.endsWith('.DCE')
              ? 'DCE'
              : 'SSE');
    const calendar = await getDatabase().datasetSyncPartition.findMany({
      where: {
        dataset: 'calendar',
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
    if (!sessions.length && !gaps.length && prepared.evidence.emptyResponse === true) {
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
    prepared.evidence.terminalPage === true &&
    prepared.evidence.sourceFailed === false &&
    prepared.evidence.invalidRows === 0 &&
    !prepared.errors.length
  ) {
    gaps.push(...(await stockPartitionCoverage(partition, prepared)));
    if (!gaps.length) {
      prepared.status = 'complete';
      prepared.gaps = [];
      prepared.evidence.businessExtent =
        partition.dataset === 'stock-prices'
          ? 'Verified listing intervals and full-day suspension evidence'
          : 'All verified same-day traded securities are present';
      for (const table of prepared.tables) {
        table.replacementRequest = {
          where: { tradeDate: partition.startDate },
          basis: String(prepared.evidence.businessExtent),
        };
      }
    }
  }
  if (gaps.length) {
    prepared.status = 'partial';
    prepared.gaps.push(...gaps);
  }
  for (const table of prepared.tables) {
    delete table.replacement;
    const independentSnapshot =
      table.atomic &&
      table.replacementRequest?.independent === true &&
      prepared.evidence.terminalPage === true &&
      prepared.evidence.sourceFailed === false;
    if (
      ((prepared.status === 'complete' && !prepared.errors.length) || independentSnapshot) &&
      table.replacementRequest
    ) {
      table.replacement = { ...table.replacementRequest, authoritative: true };
    }
  }
  prepared.evidence.deletionAuthorities = JSON.stringify(
    prepared.tables
      .filter((table) => table.replacement)
      .map((table) => ({
        table: table.table,
        where: table.replacement!.where,
        basis: table.replacement!.basis,
      })),
  );

  return prepared;
}
