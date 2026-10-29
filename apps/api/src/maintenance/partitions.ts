import { createHash } from 'node:crypto';
import { getDatabase } from '#infra/database/prisma.js';
import { contiguousCoverage } from '#market/synchronization/coverage.js';
import { calendarDay, localDate, localHour } from '#market/synchronization/date.js';
import { datasetScopes } from '#market/synchronization/scopes.js';
import type { DatasetPolicy, MarketPartition } from '#market/synchronization/partition.js';

export { datasetScopes } from '#market/synchronization/scopes.js';
export const SYNC_LIMITS = { partitions: 240, requests: 600, milliseconds: 30 * 60_000 } as const;
export interface PlannedPartition extends MarketPartition {
  id: string;
  policyVersion: string;
  history: boolean;
}
export interface SelectWindowInput {
  policy: DatasetPolicy;
  targetDate: string;
  startedAt: Date;
  history: boolean;
  attempted: ReadonlySet<string>;
  deadline: number;
}

function identity(window: MarketPartition) {
  return createHash('sha256')
    .update(JSON.stringify([window.dataset, window.scope, window.startDate, window.endDate]))
    .digest('hex');
}

/** 固定周期窗口只由历史边界和目标生成。 / Derive fixed windows from lifecycle bounds and target. */
function* periodWindows(start: string, end: string, period: DatasetPolicy['period']) {
  let cursor = start;
  while (cursor <= end) {
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(4, 6));
    if (period === 'quarter') {
      const last = new Date(Date.UTC(year, Math.ceil(month / 3) * 3, 0))
        .toISOString()
        .slice(0, 10)
        .replaceAll('-', '');
      if (last > end) {
        return;
      }
      yield { startDate: last, endDate: last };
      cursor = calendarDay(last, 1);
      continue;
    }
    const last =
      period === 'year'
        ? `${year}1231`
        : period === 'month'
          ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10).replaceAll('-', '')
          : cursor;
    const endDate = last < end ? last : end;
    yield { startDate: cursor, endDate };
    cursor = calendarDay(endDate, 1);
  }
}

/**
 * 只选一个真正要请求的窗口；不写计划游标或 pending 队列。
 *
 * Select one actual request without persisting planning cursors or pending queues.
 */
export async function selectSyncWindow(input: SelectWindowInput): Promise<PlannedPartition | null> {
  const { policy } = input;
  if (input.history && policy.period === 'catalog') {
    return null;
  }
  const database = getDatabase();
  const objects = await datasetScopes(policy);
  const states = await database.datasetSyncState.findMany({ where: { dataset: policy.dataset } });
  const byScope = new Map(states.map((state) => [state.scope, state]));
  const touched = (scope: string) =>
    (input.history
      ? byScope.get(scope)?.lastBackfillAt
      : byScope.get(scope)?.lastCheckedAt
    )?.getTime() ?? 0;
  objects.sort(
    (left, right) =>
      touched(left.scope) - touched(right.scope) || left.scope.localeCompare(right.scope),
  );

  for (const object of objects) {
    if (Date.now() >= input.deadline) {
      return null;
    }
    const today = localDate(input.startedAt, policy.timeZone);
    const completed =
      localHour(input.startedAt, policy.timeZone) >= policy.closeHour
        ? today
        : calendarDay(today, -1);
    const end = [
      input.targetDate,
      object.endDate ?? input.targetDate,
      policy.period === 'catalog' ? input.targetDate : completed,
    ].sort()[0];
    if (end < object.startDate) {
      continue;
    }
    const saved = await database.datasetSyncPartition.findMany({
      where: { dataset: policy.dataset, scope: object.scope },
      orderBy: { startDate: 'asc' },
    });
    const complete = saved.filter(
      (window) =>
        ['complete', 'not_applicable'].includes(window.status) &&
        window.policyVersion === policy.version,
    );
    const due = (checked: Date | null) =>
      !checked || input.startedAt.getTime() - checked.getTime() >= policy.refreshDays * 86400_000;
    let windows: Array<{ startDate: string; endDate: string }>;
    const lower = [object.startDate, calendarDay(end, -policy.revisionDays)].sort().at(-1)!;

    if (policy.period === 'catalog') {
      if (complete.some((window) => !due(window.checkedAt))) {
        continue;
      }
      windows = [{ startDate: input.targetDate, endDate: input.targetDate }];
    } else if (policy.dataset === 'calendar' && !input.history) {
      if (
        complete.some(
          (window) =>
            window.startDate <= `${end.slice(0, 4)}0101` &&
            window.endDate >= end &&
            !due(window.checkedAt),
        )
      ) {
        continue;
      }
      windows = [{ startDate: `${end.slice(0, 4)}0101`, endDate: calendarDay(end, 31) }];
    } else {
      let start = input.history ? object.startDate : lower;
      if (!input.history && policy.period === 'year') {
        start = [object.startDate, `${lower.slice(0, 4)}0101`].sort().at(-1)!;
      }
      if (!input.history && policy.period === 'month') {
        start = [object.startDate, `${lower.slice(0, 6)}01`].sort().at(-1)!;
      }
      if (policy.period === 'day') {
        const proof = await database.datasetSyncPartition.findMany({
          where: {
            dataset: 'calendar',
            scope: policy.calendar,
            status: 'complete',
            policyVersion: policy.version,
            startDate: { lte: end },
            endDate: { gte: start },
          },
        });
        const verifiedEnd = contiguousCoverage(start, proof);
        if (!verifiedEnd) {
          continue;
        }
        const sessions = await database.tradeCal.findMany({
          where: {
            exchange: policy.calendar,
            isOpen: 1,
            calDate: { gte: start, lte: verifiedEnd < end ? verifiedEnd : end },
          },
          orderBy: { calDate: 'asc' },
        });
        windows = sessions.map((session) => ({
          startDate: session.calDate,
          endDate: session.calDate,
        }));
      } else {
        windows = [...periodWindows(start, end, policy.period)];
      }
      // 已落盘的失败边界继续原样重试，不随新目标延伸。
      // Retry persisted failure bounds unchanged when the target advances.
      windows.unshift(
        ...saved.filter(
          (window) =>
            !complete.includes(window) &&
            window.startDate >= object.startDate &&
            window.endDate <= end &&
            (input.history || window.endDate >= lower),
        ),
      );
      windows = windows.filter((window) => {
        const proof = complete.find(
          (known) => known.startDate <= window.startDate && known.endDate >= window.endDate,
        );
        return input.history ? !proof : !proof || due(proof.checkedAt);
      });
      if (!input.history) {
        const checked = (window: (typeof windows)[number]) =>
          saved
            .find(
              (known) => known.startDate === window.startDate && known.endDate === window.endDate,
            )
            ?.checkedAt?.getTime() ?? 0;
        windows.sort(
          (left, right) =>
            checked(left) - checked(right) || right.endDate.localeCompare(left.endDate),
        );
      } else {
        windows.sort((left, right) => left.startDate.localeCompare(right.startDate));
      }
    }

    for (const window of windows) {
      const partition = {
        dataset: policy.dataset,
        scope: object.scope,
        startDate: window.startDate,
        endDate: window.endDate,
      };
      const id = identity(partition);
      if (!input.attempted.has(id)) {
        return { ...partition, id, policyVersion: policy.version, history: input.history };
      }
    }
  }

  return null;
}
