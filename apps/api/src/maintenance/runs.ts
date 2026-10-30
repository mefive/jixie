import { ulid } from 'ulid';
import type { DataSyncResult } from '@jixie/shared/api/maintenance';
import { getDatabase } from '#infra/database/prisma.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { readHistoryGaps, readDatasetCoverage } from './status.js';

/**
 * 恢复旧运行并创建本轮记录。
 *
 * Recover interrupted work and create this run's record.
 */
export async function startSyncRun(targetDate: string, startedAt: Date, now: Date) {
  const database = getDatabase();
  const previous = await database.dataSyncRun.findFirst({ orderBy: { startedAt: 'desc' } });
  const summary = previous?.summary;
  const resume =
    summary &&
    typeof summary === 'object' &&
    !Array.isArray(summary) &&
    typeof summary.resumeDataset === 'string'
      ? summary.resumeDataset
      : '';
  const nextIndex = Math.max(
    0,
    DATASET_POLICIES.findIndex((policy) => policy.dataset === resume),
  );
  const result: DataSyncResult = {
    runId: ulid(),
    targetDate: targetDate,
    status: 'complete',
    partitions: 0,
    accepted: { inserted: 0, updated: 0, deleted: 0, rejected: 0 },
    coverage: [],
    gaps: [],
    errors: [],
  };
  await database.marketDataState.upsert({
    where: { key: 'global' },
    create: { key: 'global' },
    update: {},
  });
  await database.dataSyncRun.updateMany({
    where: { status: 'running' },
    data: {
      status: 'interrupted',
      stage: 'interrupted',
      finishedAt: now,
      error: 'Writer exited before terminal recording',
    },
  });
  await database.dataSyncRun.create({
    data: {
      id: result.runId,
      targetDate: targetDate,
      status: 'running',
      stage: 'references',
      startedAt: startedAt,
      summary: { resumeDataset: resume },
    },
  });
  await database.dataSyncRun.deleteMany({
    where: { id: { not: result.runId }, ...(previous ? { NOT: { id: previous.id } } : {}) },
  });

  return { result, nextIndex };
}

/**
 * 汇总本轮结果，历史缺口单独呈现。
 *
 * Summarize this run separately from historical gaps.
 */
export async function finishSyncRun(
  result: DataSyncResult,
  nextIndex: number,
  startedAt: Date,
  now: Date,
): Promise<void> {
  const database = getDatabase();
  result.coverage = await readDatasetCoverage();
  for (const coverage of result.coverage) {
    if (coverage.pending) {
      result.gaps.push(
        `${coverage.dataset}: ${coverage.pending} attempted windows remain incomplete`,
      );
    }
  }

  result.gaps.push(...(await readHistoryGaps(result.targetDate, startedAt)));
  result.errors = [...new Set(result.errors)];
  result.gaps = [...new Set(result.gaps)];
  result.status = result.errors.length ? 'error' : result.gaps.length ? 'partial' : 'complete';

  await database.dataSyncRun.update({
    where: { id: result.runId },
    data: {
      status: result.status,
      stage: 'finished',
      finishedAt: now,
      heartbeatAt: now,
      error: result.errors.join('\n') || null,
      summary: JSON.parse(
        JSON.stringify({ ...result, resumeDataset: DATASET_POLICIES[nextIndex].dataset }),
      ),
    },
  });
}
