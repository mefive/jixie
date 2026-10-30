import type { Prisma } from '@prisma/client';
import { calendarDay } from './date.js';
import { datasetScopes } from './scopes.js';
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
  requestedStart?: string,
): Promise<void> {
  const policy = DATASET_POLICIES.find((entry) => entry.dataset === dataset)!;
  const object = requestedStart
    ? undefined
    : (await datasetScopes(policy)).find((entry) => entry.scope === scope);
  const historyStart = requestedStart ?? object?.startDate ?? policy.startDate;
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
  if (['snapshot', 'reports', 'events'].includes(policy.completion)) {
    verifiedThrough = null;
  } else if (policy.period === 'catalog') {
    verifiedThrough =
      complete
        .map((partition) => partition.endDate)
        .sort()
        .at(-1) ?? null;
  } else if (policy.period === 'day') {
    const lastCompleteDate =
      complete
        .map((partition) => partition.endDate)
        .sort()
        .at(-1) ?? historyStart;
    const calendarProof = await transaction.datasetSyncPartition.findMany({
      where: {
        dataset: 'calendar',
        scope: policy.calendar,
        status: 'complete',
        policyVersion: policy.version,
        startDate: { lte: lastCompleteDate },
        endDate: { gte: historyStart },
      },
    });
    const calendarThrough = contiguousCoverage(historyStart, calendarProof);
    const sessions = await transaction.tradeCal.findMany({
      where: {
        exchange: policy.calendar,
        isOpen: 1,
        calDate: { gte: historyStart, lte: lastCompleteDate },
      },
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
    });
    const verifiedSessions = sessions
      .map((session) => session.calDate)
      .filter((date) => calendarThrough && date <= calendarThrough);

    verifiedThrough = contiguousCoverage(historyStart, complete, verifiedSessions);
  } else if (policy.period === 'quarter') {
    const firstYear = Number(historyStart.slice(0, 4));
    const lastYear = Number(complete.at(-1)?.endDate.slice(0, 4) ?? historyStart.slice(0, 4));
    const reportDates: string[] = [];

    for (let year = firstYear; year <= lastYear; year++) {
      for (const quarterEnd of ['0331', '0630', '0930', '1231']) {
        const date = `${year}${quarterEnd}`;
        if (date >= historyStart) {
          reportDates.push(date);
        }
      }
    }

    verifiedThrough = contiguousCoverage(historyStart, complete, reportDates);
  } else {
    verifiedThrough = contiguousCoverage(historyStart, complete);
  }
  await transaction.datasetSyncState.update({
    where: { dataset_scope: { dataset, scope } },
    data: { verifiedThrough },
  });
}
