import type { Prisma } from '@prisma/client';
import type {
  MarketPartition,
  MarketTransaction,
  CoverageChange,
} from '#market/synchronization/partition.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { updateVerifiedCoverage } from '#market/synchronization/coverage.js';

/**
 * 目录只撤销实际改变的上市区间；请求失败本身不否定过去已经确认的目录事实。
 *
 * Catalogs invalidate changed listing intervals only; a failed fetch does not disprove past facts.
 */
export async function invalidateDependents(
  transaction: MarketTransaction,
  partition: MarketPartition,
  catalogChanges: CoverageChange[] = [],
): Promise<number> {
  let ranges: CoverageChange[];
  switch (partition.dataset) {
    case 'stock-master':
    case 'etf-master':
      ranges = catalogChanges;
      break;
    case 'calendar':
      ranges =
        partition.scope === 'SSE'
          ? DATASET_POLICIES.filter((policy) => policy.completion === 'sessions').map((policy) => ({
              ...partition,
              dataset: policy.dataset,
              scope: '',
            }))
          : [];
      break;
    case 'stock-prices':
      ranges = ['stock-adjustments', 'stock-valuations', 'stock-limits'].map((dataset) => ({
        ...partition,
        dataset,
      }));
      break;
    default:
      return 0;
  }

  const unique = [...new Map(ranges.map((range) => [JSON.stringify(range), range])).values()];
  const affected = new Map<string, { dataset: string; scope: string }>();
  let invalidated = 0;
  for (let offset = 0; offset < unique.length; offset += 100) {
    const where: Prisma.DatasetSyncPartitionWhereInput = {
      status: { in: ['complete', 'not_applicable'] },
      OR: unique.slice(offset, offset + 100).map((range) => ({
        dataset: range.dataset,
        ...(range.scope ? { scope: range.scope } : {}),
        ...(range.endDate ? { startDate: { lte: range.endDate } } : {}),
        endDate: { gte: range.startDate },
      })),
    };
    const scopes = await transaction.datasetSyncPartition.findMany({
      where,
      select: { dataset: true, scope: true },
      distinct: ['dataset', 'scope'],
    });
    for (const scope of scopes) {
      affected.set(`${scope.dataset}/${scope.scope}`, scope);
    }
    const result = await transaction.datasetSyncPartition.updateMany({
      where,
      data: { status: 'partial', error: null, gaps: ['Dependency changed; revalidation required'] },
    });
    invalidated += result.count;
  }
  for (const { dataset, scope } of affected.values()) {
    const etf =
      dataset === 'etf-prices' || dataset === 'etf-adjustments'
        ? await transaction.etfBasic.findUnique({
            where: { tsCode: scope },
            select: { listDate: true },
          })
        : undefined;
    await updateVerifiedCoverage(transaction, dataset, scope, etf?.listDate ?? undefined);
  }

  return invalidated;
}
