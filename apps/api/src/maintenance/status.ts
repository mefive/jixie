import { contiguousCoverage } from '#market/synchronization/coverage.js';
import { calendarDay, localDate, localHour } from '#market/synchronization/date.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { datasetScopes } from '#market/synchronization/scopes.js';
import type { DatasetCoverage, MaintenanceStatus } from '@jixie/shared/api/maintenance';
import { getDatabase } from '#infra/database/prisma.js';
import {
  isMarketPublicationActive,
  isMaintenanceOwnerActive,
} from '#infra/coordination/market-access.js';
import { marketRevision } from '#market/synchronization/readiness.js';
export type { MaintenanceStatus } from '@jixie/shared/api/maintenance';

/**
 * 展示观察和覆盖事实，不把旧全局日水位当作所有来源就绪。
 *
 * Show observed and verified coverage without interpreting an old daily watermark as global
 * readiness.
 */
export async function readDatasetCoverage(): Promise<DatasetCoverage[]> {
  const database = getDatabase();
  const states = await database.datasetSyncState.findMany();
  const partitions = await database.datasetSyncPartition.findMany({
    where: { status: { notIn: ['superseded', 'unavailable'] } },
  });
  const coverage: DatasetCoverage[] = [];

  for (const policy of DATASET_POLICIES) {
    for (const object of await datasetScopes(policy)) {
      const state = states.find(
        (entry) => entry.dataset === policy.dataset && entry.scope === object.scope,
      );
      const current = partitions.filter(
        (entry) =>
          entry.dataset === policy.dataset &&
          entry.scope === object.scope &&
          entry.policyVersion === policy.version &&
          entry.endDate >= object.startDate &&
          (!object.endDate || entry.startDate <= object.endDate),
      );
      const completed = current.filter((entry) =>
        ['complete', 'not_applicable'].includes(entry.status),
      );
      const dense = ['sessions', 'calendar'].includes(policy.completion);
      coverage.push({
        dataset: policy.dataset,
        scope: object.scope,
        completion: policy.completion,
        maxObservedDate: state?.maxObservedDate ?? null,
        verifiedThrough:
          dense && !object.blockedReason && completed.length
            ? (state?.verifiedThrough ?? null)
            : null,
        checkedThrough:
          completed
            .map((entry) => entry.endDate)
            .sort()
            .at(-1) ?? null,
        lastCheckedAt: state?.lastCheckedAt?.toISOString() ?? null,
        pending: current.filter((entry) => !['complete', 'not_applicable'].includes(entry.status))
          .length,
        errors: current.filter((entry) => entry.status === 'error').length,
      });
    }
  }
  const byDataset = new Map<string, DatasetCoverage>();
  for (const row of coverage) {
    const previous = byDataset.get(row.dataset);
    byDataset.set(
      row.dataset,
      previous
        ? {
            dataset: row.dataset,
            scope: 'all',
            completion: row.completion,
            checkedThrough:
              previous.checkedThrough && row.checkedThrough
                ? [previous.checkedThrough, row.checkedThrough].sort()[0]
                : null,
            lastCheckedAt:
              [previous.lastCheckedAt ?? '', row.lastCheckedAt ?? ''].sort().at(-1) || null,
            maxObservedDate:
              [previous.maxObservedDate ?? '', row.maxObservedDate ?? ''].sort().at(-1) || null,
            verifiedThrough:
              previous.verifiedThrough && row.verifiedThrough
                ? [previous.verifiedThrough, row.verifiedThrough].sort()[0]
                : null,
            pending: previous.pending + row.pending,
            errors: previous.errors + row.errors,
          }
        : { ...row, scope: 'all' },
    );
  }

  return [...byDataset.values()];
}

/**
 * 空库、来源缺口及历史错误均不封站；只报告真实发布锁。
 *
 * Empty data, source gaps and historical errors never gate the app; report actual publication
 * locks.
 */
export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const [publicationActive, running, run, revision, coverage, deployment] = await Promise.all([
    isMarketPublicationActive(),
    isMaintenanceOwnerActive(),
    getDatabase().dataSyncRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    marketRevision(),
    readDatasetCoverage(),
    getDatabase().maintenanceRun.findFirst({
      where: { kind: 'deploy', status: 'running' },
      orderBy: { startedAt: 'desc' },
    }),
  ]);

  const deploying =
    publicationActive && deployment && (!run || deployment.startedAt >= run.startedAt);

  return {
    active: publicationActive,
    running,
    phase: publicationActive
      ? 'publishing'
      : running
        ? 'preparing'
        : run?.status === 'error'
          ? 'error'
          : run || coverage.some((entry) => entry.verifiedThrough || entry.maxObservedDate)
            ? 'idle'
            : 'uninitialized',
    runId: deploying ? deployment.id : (run?.id ?? null),
    kind: deploying ? 'deploy' : run ? 'sync' : null,
    targetDate: run?.targetDate ?? null,
    stage: deploying ? deployment.stage : (run?.stage ?? null),
    startedAt: run?.startedAt.toISOString() ?? null,
    heartbeatAt: run?.heartbeatAt.toISOString() ?? null,
    error: run?.error ?? null,
    retryAfterSeconds: publicationActive ? 5 : 0,
    revision,
    coverage,
  };
}

/**
 * 按周期和退市边界报告历史缺口，不要求季度数据达到当天。
 *
 * Bound required history by period and lifecycle, not today's date for every series.
 */
export async function readHistoryGaps(targetDate: string, startedAt: Date): Promise<string[]> {
  const database = getDatabase();
  const states = await database.datasetSyncState.findMany();
  const byScope = new Map(
    states.map((state) => [JSON.stringify([state.dataset, state.scope]), state]),
  );
  const gaps: string[] = [];
  for (const policy of DATASET_POLICIES) {
    if (policy.period === 'catalog') {
      continue;
    }
    let missing = 0;
    for (const object of await datasetScopes(policy)) {
      if (object.blockedReason) {
        gaps.push(`${policy.dataset}/${object.scope}: ${object.blockedReason}`);
        continue;
      }

      const today = localDate(startedAt, policy.timeZone);
      const completed =
        localHour(startedAt, policy.timeZone) >= policy.closeHour ? today : calendarDay(today, -1);
      let end = [targetDate, completed, object.endDate ?? targetDate].sort()[0];
      if (end < object.startDate) {
        continue;
      }
      if (policy.period === 'quarter') {
        end = [end, calendarDay(today, -1)].sort()[0];
        const year = Number(end.slice(0, 4));
        end = [
          `${year - 1}1231`,
          ...['0331', '0630', '0930', '1231'].map((suffix) => `${year}${suffix}`),
        ]
          .filter((date) => date <= end)
          .at(-1)!;
      }
      if (policy.period === 'day') {
        const last = await database.tradeCal.findFirst({
          where: {
            exchange: policy.calendar,
            isOpen: 1,
            calDate: { gte: object.startDate, lte: end },
          },
          orderBy: { calDate: 'desc' },
        });
        if (!last) {
          missing++;
          continue;
        }
        end = last.calDate;
      }
      let through = byScope.get(JSON.stringify([policy.dataset, object.scope]))?.verifiedThrough;
      if (['reports', 'snapshot', 'events'].includes(policy.completion)) {
        const checked = await database.datasetSyncPartition.findMany({
          where: {
            dataset: policy.dataset,
            scope: object.scope,
            policyVersion: policy.version,
            status: { in: ['complete', 'not_applicable'] },
          },
          orderBy: { startDate: 'asc' },
        });
        if (policy.completion === 'reports') {
          const firstYear = Number(object.startDate.slice(0, 4));
          const lastYear = Number(end.slice(0, 4));
          const reportDates: string[] = [];

          for (let year = firstYear; year <= lastYear; year++) {
            for (const quarterEnd of ['0331', '0630', '0930', '1231']) {
              const date = `${year}${quarterEnd}`;
              if (date >= object.startDate && date <= end) {
                reportDates.push(date);
              }
            }
          }

          through = contiguousCoverage(object.startDate, checked, reportDates);
        } else {
          through = contiguousCoverage(object.startDate, checked);
        }
      }
      if (!through || through < end) {
        missing++;
      }
    }
    if (missing) {
      gaps.push(`${policy.dataset}: ${missing} object histories remain unverified`);
    }
  }

  return gaps;
}
