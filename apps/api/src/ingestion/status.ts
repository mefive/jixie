import { getDatabase } from '#infra/database/prisma.js';
import {
  isMaintenanceOwnerActive,
  isMarketPublicationActive,
} from '#infra/coordination/market-access.js';
import { marketRevision } from '#market/synchronization/readiness.js';
import type { IngestionStatus } from '@jixie/shared/api/ingestion';
import { unitKey } from './runs.js';
import { runPlanSchema } from './schema.js';

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
  const issue = run ? await currentIssue(run.id, run.status, run.scopeSnapshot) : null;

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

/**
 * 只展示当前计划最近尝试的问题，不因保留旧诊断反复报告已修复故障。
 *
 * Show issues from the current plan's latest attempt without resurfacing repaired history.
 */
async function currentIssue(runId: string, status: string, snapshot: unknown) {
  if (status === 'completed') {
    return null;
  }

  const parsed = runPlanSchema.safeParse(snapshot);
  const required = parsed.success
    ? new Set(
        [
          ...parsed.data.referenceUnits,
          ...(parsed.data.selectionUnits ?? []),
          ...(parsed.data.plan?.units ?? []),
        ].map(unitKey),
      )
    : undefined;
  const database = getDatabase();
  let cursor: string | undefined;
  while (true) {
    const issue = await database.ingestionIssue.findFirst({
      where: { runId, severity: { not: 'warning' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { batch: { select: { dataset: true, scope: true, period: true } } },
    });
    if (!issue) {
      return null;
    }
    cursor = issue.id;
    if (!issue.batch) {
      if (status === 'failed' || status === 'completed_with_issues') {
        return issue;
      }
      continue;
    }
    if (required && !required.has(unitKey(issue.batch))) {
      continue;
    }

    const latest = await database.ingestionBatch.findFirst({
      where: { runId, ...issue.batch },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true },
    });
    if (latest?.id === issue.batchId && latest.status !== 'succeeded') {
      return issue;
    }
  }
}
