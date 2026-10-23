import type { Prisma } from '@prisma/client';
import { calendarDay } from './date.js';
import { DATASET_POLICIES } from './policies.js';

export interface CoverageExtent {
  startDate: string;
  endDate: string;
}

/**
 * 只有相接的完整分区能推进水位；重叠分区可以跨过已证实的范围。
 *
 * Only contiguous complete partitions advance coverage; overlapping proof may bridge verified
 * extents.
 */
export function contiguousCoverage(
  start: string,
  partitions: CoverageExtent[],
  sessions?: string[],
): string | null {
  if (sessions) {
    let verified: string | null = null;
    for (const session of sessions) {
      if (session < start) {
        continue;
      }
      if (
        !partitions.some(
          (partition) => partition.startDate <= session && partition.endDate >= session,
        )
      ) {
        break;
      }
      verified = session;
    }

    return verified;
  }
  let cursor = start;
  for (const partition of [...partitions].sort((left, right) =>
    left.startDate.localeCompare(right.startDate),
  )) {
    if (partition.startDate > cursor) {
      break;
    }
    if (partition.endDate >= cursor) {
      cursor = calendarDay(partition.endDate, 1);
    }
  }

  return cursor > start ? calendarDay(cursor, -1) : null;
}

/**
 * 和原始值及分区状态在同一事务中更新；不以最大观察日代替核验。
 *
 * Update with raw values and partition status in the same transaction, never substitute a maximum
 * observed date.
 */
export async function updateVerifiedCoverage(
  transaction: Prisma.TransactionClient,
  dataset: string,
  scope: string,
): Promise<void> {
  const policy = DATASET_POLICIES.find((entry) => entry.dataset === dataset)!;
  const state = await transaction.datasetSyncState.findUniqueOrThrow({
    where: { dataset_scope: { dataset, scope } },
  });
  const complete = await transaction.datasetSyncPartition.findMany({
    where: {
      dataset,
      scope,
      policyVersion: policy.version,
      status: { in: ['complete', 'not_applicable'] },
    },
    orderBy: { startDate: 'asc' },
    select: { startDate: true, endDate: true },
  });
  let verifiedThrough: string | null;
  if (policy.period === 'catalog') {
    verifiedThrough =
      complete
        .map((partition) => partition.endDate)
        .sort()
        .at(-1) ?? null;
  } else if (policy.period === 'day' || policy.period === 'quarter') {
    const calendarProof =
      policy.period === 'day'
        ? await transaction.datasetSyncPartition.findMany({
            where: {
              dataset: 'calendar',
              scope: policy.calendar,
              status: 'complete',
              startDate: {
                lte:
                  complete
                    .map((partition) => partition.endDate)
                    .sort()
                    .at(-1) ?? state.historyStart,
              },
              endDate: { gte: state.historyStart },
            },
          })
        : [];
    const calendarThrough =
      policy.period === 'day' ? contiguousCoverage(state.historyStart, calendarProof) : null;

    const sessions =
      policy.period === 'day'
        ? (
            await transaction.tradeCal.findMany({
              where: {
                exchange: policy.calendar,
                isOpen: 1,
                calDate: {
                  gte: state.historyStart,
                  lte:
                    complete
                      .map((partition) => partition.endDate)
                      .sort()
                      .at(-1) ?? state.historyStart,
                },
              },
              orderBy: { calDate: 'asc' },
              select: { calDate: true },
            })
          ).map((session) => session.calDate)
        : Array.from(
            {
              length: Math.max(
                0,
                (Number(complete.at(-1)?.endDate.slice(0, 4) ?? state.historyStart.slice(0, 4)) -
                  Number(state.historyStart.slice(0, 4)) +
                  1) *
                  4,
              ),
            },
            (_, index) =>
              `${Number(state.historyStart.slice(0, 4)) + Math.floor(index / 4)}${['0331', '0630', '0930', '1231'][index % 4]}`,
          ).filter((date) => date >= state.historyStart);
    verifiedThrough = contiguousCoverage(
      state.historyStart,
      complete,
      policy.period === 'day'
        ? sessions.filter((date) => calendarThrough && date <= calendarThrough)
        : sessions,
    );
  } else {
    verifiedThrough = contiguousCoverage(state.historyStart, complete);
  }
  await transaction.datasetSyncState.update({
    where: { dataset_scope: { dataset, scope } },
    data: { verifiedThrough },
  });
}
