import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { getDatabase } from '#infra/database/prisma.js';
import { withMarketPublication } from '#infra/coordination/market-access.js';
import { writeMarketPartition } from '#market/synchronization/prepare.js';
import { updateVerifiedCoverage } from '#market/synchronization/coverage.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { calendarDay } from '#market/synchronization/date.js';
import type {
  MarketTransaction,
  PreparedMarketPartition,
} from '#market/synchronization/partition.js';
import type { PlannedPartition } from './partitions.js';

export async function recordAttempt(partition: PlannedPartition, runId: string, fetchedAt: Date) {
  const database = getDatabase();
  const { id, dataset, scope, startDate, endDate, policyVersion } = partition;
  await database.$transaction(async (transaction) => {
    await transaction.datasetSyncPartition.upsert({
      where: { id },
      create: {
        id,
        dataset,
        scope,
        startDate,
        endDate,
        policyVersion,
        status: 'pending',
        lastRunId: runId,
        lastAttemptAt: fetchedAt,
      },
      update: { lastRunId: runId, lastAttemptAt: fetchedAt },
    });
    await transaction.datasetSyncState.upsert({
      where: { dataset_scope: { dataset, scope } },
      create: {
        dataset,
        scope,
        lastCheckedAt: fetchedAt,
        ...(partition.history ? { lastBackfillAt: fetchedAt } : {}),
      },
      update: {
        lastCheckedAt: fetchedAt,
        ...(partition.history ? { lastBackfillAt: fetchedAt } : {}),
      },
    });
  });
}

/**
 * 原始值、窗口资格、覆盖和修订号在同一短事务发布。
 *
 * Publish values, eligibility, coverage and revision atomically.
 */
export async function publishWindow(
  partition: PlannedPartition,
  prepared: PreparedMarketPartition,
  runId: string,
  fetchedAt: Date,
) {
  const database = getDatabase();

  return withMarketPublication(() =>
    database.$transaction(
      async (transaction) => {
        const accepted = await writeMarketPartition(transaction, prepared, partition, fetchedAt);
        const errors = [...prepared.errors, ...accepted.errors];
        const status = errors.length ? 'error' : prepared.status;
        const verified = status === 'complete' || status === 'not_applicable';
        const previous = await transaction.datasetSyncPartition.findUniqueOrThrow({
          where: { id: partition.id },
        });

        // 重叠旧窗口不能掩盖这次发现的缺口；恢复时只认覆盖该范围的完整结果。
        // Old overlapping windows cannot mask a newly observed gap;
        // restore only proven complete extents.
        const catalog =
          DATASET_POLICIES.find((policy) => policy.dataset === partition.dataset)!.completion ===
          'catalog';
        const overlapFilter: Prisma.DatasetSyncPartitionWhereInput = {
          dataset: partition.dataset,
          scope: partition.scope,
          id: { not: partition.id },
        };
        if (catalog) {
          overlapFilter.status = { notIn: ['superseded', 'unavailable'] };
        } else if (verified) {
          overlapFilter.startDate = { gte: partition.startDate };
          overlapFilter.endDate = { lte: partition.endDate };
          overlapFilter.status = {
            notIn: ['complete', 'not_applicable', 'superseded', 'unavailable'],
          };
        } else {
          overlapFilter.startDate = { lte: partition.endDate };
          overlapFilter.endDate = { gte: partition.startDate };
          overlapFilter.policyVersion = partition.policyVersion;
          overlapFilter.status = { in: ['complete', 'not_applicable'] };
        }

        const overlapping = await transaction.datasetSyncPartition.updateMany({
          where: overlapFilter,
          data: {
            status: verified ? 'superseded' : 'partial',
            policyVersion: partition.policyVersion,
            ...(!verified
              ? {
                  error: 'Overlapping source window needs verification',
                  gaps: ['Overlapping source window needs verification'],
                }
              : {}),
          },
        });
        await transaction.datasetSyncPartition.update({
          where: { id: partition.id },
          data: {
            status,
            policyVersion: partition.policyVersion,
            lastRunId: runId,
            lastAttemptAt: fetchedAt,
            checkedAt: verified ? fetchedAt : previous.checkedAt,
            gaps: prepared.gaps,
            error: errors.join('\n') || null,
          },
        });

        if (
          prepared.sourceStartDate &&
          prepared.sourceStartDate > partition.startDate &&
          !errors.length
        ) {
          const boundary = {
            dataset: partition.dataset,
            scope: partition.scope,
            startDate: DATASET_POLICIES.find((policy) => policy.dataset === partition.dataset)!
              .startDate,
            endDate: calendarDay(prepared.sourceStartDate, -1),
          };
          const id = createHash('sha256')
            .update(
              JSON.stringify([
                boundary.dataset,
                boundary.scope,
                boundary.startDate,
                boundary.endDate,
              ]),
            )
            .digest('hex');
          await transaction.datasetSyncPartition.upsert({
            where: { id },
            create: {
              id,
              ...boundary,
              policyVersion: partition.policyVersion,
              status: 'unavailable',
              checkedAt: fetchedAt,
              lastAttemptAt: fetchedAt,
              lastRunId: runId,
            },
            update: {
              status: 'unavailable',
              policyVersion: partition.policyVersion,
              checkedAt: fetchedAt,
              error: null,
              gaps: [],
            },
          });
        }
        const state = await transaction.datasetSyncState.findUniqueOrThrow({
          where: { dataset_scope: { dataset: partition.dataset, scope: partition.scope } },
        });
        await transaction.datasetSyncState.update({
          where: { dataset_scope: { dataset: partition.dataset, scope: partition.scope } },
          data: {
            maxObservedDate:
              [...accepted.observedDates, state.maxObservedDate ?? ''].sort().at(-1) || null,
          },
        });
        await updateVerifiedCoverage(
          transaction,
          partition.dataset,
          partition.scope,
          prepared.sourceStartDate,
        );

        const previouslyVerified =
          ['complete', 'not_applicable'].includes(previous.status) &&
          previous.policyVersion === partition.policyVersion;
        const invalidated =
          accepted.changed || !verified ? await invalidateDependents(transaction, partition) : 0;
        if (
          accepted.changed ||
          overlapping.count > 0 ||
          invalidated > 0 ||
          previouslyVerified !== verified
        ) {
          await transaction.marketDataState.update({
            where: { key: 'global' },
            data: { revision: { increment: 1 } },
          });
        }

        return { accepted, errors };
      },
      { timeout: 120_000 },
    ),
  );
}

/**
 * 日历、目录和价格被更正或失效后，撤销依赖范围的旧资格。
 *
 * Revoke dependent eligibility when calendars, catalogs or prices change or fail.
 */
async function invalidateDependents(
  transaction: MarketTransaction,
  partition: PlannedPartition,
): Promise<number> {
  let datasets: string[];
  switch (partition.dataset) {
    case 'calendar':
      datasets =
        partition.scope === 'SSE'
          ? DATASET_POLICIES.filter((policy) => policy.completion === 'sessions').map(
              (policy) => policy.dataset,
            )
          : [];
      break;
    case 'stock-master':
      datasets = ['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'];
      break;
    case 'etf-master':
      datasets = ['etf-prices', 'etf-adjustments'];
      break;
    case 'stock-prices':
      datasets = ['stock-adjustments', 'stock-valuations', 'stock-limits'];
      break;
    default:
      datasets = [];
  }

  if (!datasets.length) {
    return 0;
  }

  const catalog = partition.dataset.endsWith('-master');
  const where = {
    dataset: { in: datasets },
    status: { in: ['complete', 'not_applicable'] },
    ...(catalog
      ? {}
      : { startDate: { lte: partition.endDate }, endDate: { gte: partition.startDate } }),
  };
  const affected = await transaction.datasetSyncPartition.findMany({
    where,
    select: { dataset: true, scope: true },
    distinct: ['dataset', 'scope'],
  });
  const result = await transaction.datasetSyncPartition.updateMany({
    where,
    data: { status: 'partial', error: null, gaps: ['Dependency changed; revalidation required'] },
  });
  if (result.count) {
    await transaction.datasetSyncState.updateMany({
      where: { OR: affected },
      data: { verifiedThrough: null },
    });
  }

  return result.count;
}
