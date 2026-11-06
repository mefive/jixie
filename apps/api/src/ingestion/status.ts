import { getDatabase } from '#infra/database/prisma.js';
import {
  isMaintenanceOwnerActive,
  MarketAccessBusyError,
  withMarketAccess,
} from '#infra/coordination/market-access.js';
import { marketRevision } from '#market/synchronization/readiness.js';
import type {
  IngestionAvailableStatus,
  IngestionPublishingStatus,
  IngestionStatus,
} from '@jixie/shared/api/ingestion';
import { readIssueOverview } from './issue-overview.js';

export const ingestionPublishingStatus = {
  active: true,
  phase: 'publishing',
  retryAfterSeconds: 5,
} as const satisfies IngestionPublishingStatus;

/**
 * 持共享锁读取完整状态；发布关闭准入时直接返回最小状态。
 *
 * Hold a shared lock for the full status read and return minimal status when publication closes admission.
 */
export async function getIngestionStatus(): Promise<IngestionStatus> {
  try {
    return await withMarketAccess(readIngestionStatus);
  } catch (error) {
    if (!(error instanceof MarketAccessBusyError)) {
      throw error;
    }

    return ingestionPublishingStatus;
  }
}

async function readIngestionStatus(): Promise<IngestionAvailableStatus> {
  const database = getDatabase();
  const [running, revision, candidate] = await Promise.all([
    isMaintenanceOwnerActive(),
    marketRevision(),
    database.ingestionRun
      .findUnique({
        where: { activeReplica: 1 },
        select: { id: true, targetDate: true, replicaPhase: true },
      })
      .catch((error: unknown) => {
        // 审阅和滚动更新期间，旧库继续提供已发布数据状态。
        // Keep reporting published status while the candidate migration is pending.
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2022') {
          return undefined;
        }
        throw error;
      }),
  ]);
  const published =
    candidate === undefined
      ? {}
      : {
          activeReplica: null,
          OR: [{ replicaPhase: null }, { replicaPhase: 'published' }],
        };
  const select = { id: true, status: true, targetDate: true, startedAt: true } as const;
  const run =
    (await database.ingestionRun.findFirst({
      where: { ...published, status: 'running' },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select,
    })) ??
    (await database.ingestionRun.findFirst({
      where: published,
      orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }, { id: 'desc' }],
      select,
    }));
  const batch =
    run && running
      ? await database.ingestionBatch.findFirst({
          where: { runId: run.id, status: 'running' },
          orderBy: { startedAt: 'desc' },
        })
      : null;
  const { health, latestError } = await database.$transaction(
    (transaction) => readIssueOverview(transaction, run?.id),
    { timeout: 120_000 },
  );

  return {
    active: false,
    running,
    phase: running
      ? 'preparing'
      : run?.status === 'failed' ||
          run?.status === 'interrupted' ||
          Boolean(health.latestRun?.handling.pending.error)
        ? 'error'
        : run
          ? 'idle'
          : 'uninitialized',
    runId: run?.id ?? null,
    kind: run ? 'ingestion' : null,
    targetDate: run?.targetDate ?? null,
    stage: batch ? `${batch.dataset}:${batch.scope}` : null,
    startedAt: run?.startedAt.toISOString() ?? null,
    heartbeatAt: batch?.startedAt.toISOString() ?? null,
    error: latestError,
    retryAfterSeconds: 0,
    revision,
    health,
    ...(candidate
      ? {
          candidate: {
            runId: candidate.id,
            targetDate: candidate.targetDate,
            phase: candidate.replicaPhase,
          },
        }
      : {}),
  };
}
