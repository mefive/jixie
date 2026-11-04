import { getDatabase } from '#infra/database/prisma.js';
import {
  isMaintenanceOwnerActive,
  isMarketPublicationActive,
} from '#infra/coordination/market-access.js';
import { marketRevision } from '#market/synchronization/readiness.js';
import type { IngestionStatus } from '@jixie/shared/api/ingestion';
import { readIssueOverview } from './issue-overview.js';

/**
 * 可用性只由实际发布锁决定，来源问题不关闭产品。
 *
 * Availability follows the actual publication lock; source issues never close the product.
 */
export async function getIngestionStatus(): Promise<IngestionStatus> {
  const database = getDatabase();
  const [active, running, run, revision] = await Promise.all([
    isMarketPublicationActive(),
    isMaintenanceOwnerActive(),
    database.ingestionRun
      .findFirst({ where: { status: 'running' }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] })
      .then(
        (run) =>
          run ??
          database.ingestionRun.findFirst({
            orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }, { id: 'desc' }],
          }),
      ),
    marketRevision(),
  ]);
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
    active,
    running,
    phase: active
      ? 'publishing'
      : running
        ? 'preparing'
        : run?.status === 'failed' ||
            run?.status === 'interrupted' ||
            Boolean(health.latestRun?.handling.pending.error)
          ? 'error'
          : run
            ? 'idle'
            : 'uninitialized',
    runId: run?.id ?? null,
    kind: active && !batch ? 'deploy' : run ? 'ingestion' : null,
    targetDate: run?.targetDate ?? null,
    stage: batch ? `${batch.dataset}:${batch.scope}` : null,
    startedAt: run?.startedAt.toISOString() ?? null,
    heartbeatAt: batch?.startedAt.toISOString() ?? null,
    error: latestError,
    retryAfterSeconds: active ? 5 : 0,
    revision,
    health,
  };
}
