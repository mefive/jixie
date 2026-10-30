import { getDatabase } from '#infra/database/prisma.js';
import type { DataSyncResult } from '@jixie/shared/api/maintenance';
import type { SourceRequestBudget } from '#market/providers/source-fetch.js';
import { MarketSyncBudgetError } from '#market/errors.js';
import { prepareMarketPartition, type SyncProviders } from '#market/synchronization/prepare.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { selectSyncWindow } from './partitions.js';
import { recordAttempt, publishWindow } from './publication.js';

interface SyncAttemptInput {
  input: { targetDate: string; startedAt: Date; providers: SyncProviders };
  index: number;
  history: boolean;
  result: DataSyncResult;
  attempted: Set<string>;
  budget: SourceRequestBudget;
  exhausted: () => boolean;
  signal: AbortSignal;
  clock: () => Date;
  log: (line: string) => void;
  resumeDataset: string;
}

/**
 * 同一操作用于参考刷新、近期更新和历史回补。
 *
 * One operation serves references, recent refreshes and historical backfills.
 */
export async function attemptSyncWindow(context: SyncAttemptInput): Promise<boolean> {
  const {
    input,
    index,
    history,
    result,
    attempted,
    budget,
    exhausted,
    signal,
    clock,
    log,
    resumeDataset,
  } = context;
  const database = getDatabase();
  if (exhausted()) {
    return false;
  }
  const partition = await selectSyncWindow({
    policy: DATASET_POLICIES[index],
    targetDate: input.targetDate,
    startedAt: input.startedAt,
    history,
    attempted,
    deadline: budget.deadline,
  });
  if (!partition || exhausted()) {
    return false;
  }

  attempted.add(partition.id);
  result.partitions++;
  const fetchedAt = clock();
  await recordAttempt(partition, result.runId, fetchedAt);
  const label = `${partition.dataset}/${partition.scope}`;
  const range = `${partition.startDate}..${partition.endDate}`;
  log(`[data sync] ${label} ${range}`);
  await database.dataSyncRun.update({
    where: { id: result.runId },
    data: { stage: `${partition.dataset}:${partition.scope}` },
  });

  const failures = budget.failures ?? 0;
  try {
    const prepared = await prepareMarketPartition(input.providers, partition, fetchedAt);
    if (prepared.status === 'waiting' && (budget.failures ?? 0) > failures) {
      prepared.errors.push(budget.lastFailure ?? 'Source request failed');
    }
    const committed = await publishWindow(partition, prepared, result.runId, fetchedAt);
    for (const field of ['inserted', 'updated', 'deleted', 'rejected'] as const) {
      result.accepted[field] += committed.accepted[field];
    }
    result.errors.push(
      ...committed.errors.map((error) => `${partition.dataset}/${partition.scope}: ${error}`),
    );
    result.gaps.push(...prepared.gaps);
  } catch (error) {
    const deferred =
      error instanceof MarketSyncBudgetError || signal.aborted || budget.remaining <= 0;
    const message = error instanceof Error ? error.message : String(error);
    (deferred ? result.gaps : result.errors).push(
      `${partition.dataset}/${partition.scope}: ${message}`,
    );
    await publishWindow(
      partition,
      {
        tables: [],
        status: deferred ? 'waiting' : 'error',
        gaps: [message],
        errors: deferred ? [] : [message],
        observedDates: [],
        checks: {
          terminalPage: false,
          sourceFailed: !deferred,
          invalidRows: 0,
          emptyResponse: true,
          pages: 0,
          sourceRows: 0,
        },
      },
      result.runId,
      fetchedAt,
    );
  }

  await database.dataSyncRun.update({
    where: { id: result.runId },
    data: {
      heartbeatAt: clock(),
      summary: JSON.parse(JSON.stringify({ ...result, resumeDataset })),
    },
  });

  return true;
}
