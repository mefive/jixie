import { ulid } from 'ulid';
import { getDatabase } from '#infra/database/prisma.js';
import type { IngestionResult } from './schema.js';

export function unitKey(unit: { dataset: string; scope: string; period: string }): string {
  return JSON.stringify([unit.dataset, unit.scope, unit.period]);
}

/**
 * 输入按尝试时间倒序排列；同一逻辑批次只取最近尝试，旧问题仍保留。
 *
 * Given attempts ordered newest first, select the latest per logical batch without deleting history.
 */
export function latestAttempts<Attempt extends { dataset: string; scope: string; period: string }>(
  attempts: Attempt[],
): Map<string, Attempt> {
  const latest = new Map<string, Attempt>();
  for (const attempt of attempts) {
    const key = unitKey(attempt);
    if (!latest.has(key)) {
      latest.set(key, attempt);
    }
  }

  return latest;
}

/**
 * 同一目标最近一轮未完成时恢复其身份；完成后的新轮才重新刷新来源。
 *
 * Resume the latest unfinished run for this target; refresh sources only in a new completed-cycle run.
 */
export async function openIngestionRun(targetDate: string, trigger: string, invokedAt: Date) {
  const database = getDatabase();

  return database.$transaction(async (transaction) => {
    await transaction.ingestionBatch.updateMany({
      where: { status: 'running' },
      data: { status: 'interrupted', finishedAt: invokedAt },
    });
    await transaction.ingestionRun.updateMany({
      where: { status: 'running' },
      data: { status: 'interrupted', finishedAt: invokedAt },
    });
    await transaction.marketDataState.upsert({
      where: { key: 'global' },
      create: { key: 'global' },
      update: {},
    });

    const previous = await transaction.ingestionRun.findFirst({
      where: { targetDate },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    });
    if (previous && previous.status !== 'completed') {
      return transaction.ingestionRun.update({
        where: { id: previous.id },
        data: { status: 'running', finishedAt: null },
      });
    }

    return transaction.ingestionRun.create({
      data: {
        id: ulid(),
        targetDate,
        trigger,
        scopeSnapshot: {},
        status: 'running',
        startedAt: invokedAt,
      },
    });
  });
}

/**
 * 摘要按当前计划的最近尝试重建，不把已修复问题或旧粒度尝试再次计为失败。
 *
 * Rebuild the summary from the current plan's latest attempts, excluding repaired or obsolete work.
 */
export async function summarizeIngestionRun(
  runId: string,
  targetDate: string,
  required: Set<string>,
): Promise<IngestionResult> {
  const database = getDatabase();
  const [attempts, warnings] = await Promise.all([
    database.ingestionBatch.findMany({
      where: { runId },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      include: { _count: { select: { issues: true } } },
    }),
    database.ingestionIssue.groupBy({
      by: ['batchId'],
      where: { runId, severity: 'warning' },
      _count: { _all: true },
    }),
  ]);
  const warningCounts = new Map(
    warnings.flatMap((entry) =>
      entry.batchId ? [[entry.batchId, entry._count._all] as const] : [],
    ),
  );
  const result: IngestionResult = {
    runId,
    targetDate,
    status: 'running',
    batches: 0,
    succeeded: 0,
    partial: 0,
    failed: 0,
    accepted: 0,
    filtered: 0,
    rejected: 0,
    issues: 0,
    warnings: 0,
  };
  for (const [key, batch] of latestAttempts(attempts)) {
    if (!required.has(key)) {
      continue;
    }

    result.batches++;
    if (batch.status === 'succeeded') {
      result.succeeded++;
    }
    if (batch.status === 'partial') {
      result.partial++;
    }
    if (batch.status === 'failed') {
      result.failed++;
    }
    result.accepted += batch.acceptedCount;
    result.filtered += batch.filteredCount;
    result.rejected += batch.rejectedCount;
    const warningCount = warningCounts.get(batch.id) ?? 0;
    result.issues += batch._count.issues - warningCount;
    result.warnings += warningCount;
  }

  return result;
}
