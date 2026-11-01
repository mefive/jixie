import { getDatabase } from '#infra/database/prisma.js';
import {
  isMaintenanceOwnerActive,
  isMarketPublicationActive,
} from '#infra/coordination/market-access.js';
import { marketRevision } from '#market/synchronization/readiness.js';
import type { IngestionStatus } from '@jixie/shared/api/ingestion';

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
    database.ingestionRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    marketRevision(),
  ]);
  const batch =
    run && running
      ? await database.ingestionBatch.findFirst({
          where: { runId: run.id, status: 'running' },
          orderBy: { startedAt: 'desc' },
        })
      : null;
  const issue = run
    ? await database.ingestionIssue.findFirst({
        where: { runId: run.id },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  return {
    active,
    running,
    phase: active
      ? 'publishing'
      : running
        ? 'preparing'
        : run?.status === 'failed' || run?.status === 'completed_with_issues'
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
    error: issue && issue.category !== 'internal' ? issue.message : null,
    retryAfterSeconds: active ? 5 : 0,
    revision,
  };
}
