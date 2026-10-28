import { RETIRED_DATASETS, RETIRED_EXCHANGES } from './retired-datasets.js';
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
  const [states, partitions] = await Promise.all([
    getDatabase().datasetSyncState.findMany({
      where: {
        dataset: { notIn: RETIRED_DATASETS },
        NOT: { dataset: 'calendar', scope: { in: RETIRED_EXCHANGES } },
      },
      orderBy: [{ dataset: 'asc' }, { scope: 'asc' }],
    }),
    getDatabase().datasetSyncPartition.groupBy({
      by: ['dataset', 'scope', 'status'],
      where: {
        dataset: { notIn: RETIRED_DATASETS },
        NOT: { dataset: 'calendar', scope: { in: RETIRED_EXCHANGES } },
      },
      _count: { _all: true },
    }),
  ]);

  const byScope = new Map<string, typeof partitions>();
  for (const partition of partitions) {
    const key = JSON.stringify([partition.dataset, partition.scope]);
    const groups = byScope.get(key) ?? [];
    groups.push(partition);
    byScope.set(key, groups);
  }
  const coverage = states.map((state) => {
    const groups = byScope.get(JSON.stringify([state.dataset, state.scope])) ?? [];

    return {
      dataset: state.dataset,
      scope: state.scope,
      maxObservedDate: state.maxObservedDate,
      verifiedThrough: state.verifiedThrough,
      pending: groups
        .filter((group) => !['complete', 'not_applicable'].includes(group.status))
        .reduce((sum, group) => sum + group._count._all, 0),
      errors: groups
        .filter((group) => group.status === 'error')
        .reduce((sum, group) => sum + group._count._all, 0),
    };
  });
  const byDataset = new Map<string, DatasetCoverage>();
  for (const row of coverage) {
    const previous = byDataset.get(row.dataset);
    byDataset.set(
      row.dataset,
      previous
        ? {
            dataset: row.dataset,
            scope: 'all',
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
          : coverage.length
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
