import { retireDatasets } from './retired-datasets.js';
import type { PreparedMarketPartition } from '#market/synchronization/partition.js';
import { updateVerifiedCoverage } from '#market/synchronization/coverage.js';
import { MarketSyncBudgetError } from '#market/errors.js';
import {
  withSourceRequestBudget,
  type SourceRequestBudget,
} from '#market/providers/source-fetch.js';
import { prepareIdentityNormalization } from '#market/instruments/normalize-identity.js';
import { STOCK_CODE_CHANGES } from '#market/instruments/stock-identity.js';
import { ulid } from 'ulid';
import type { DataSyncResult } from '@jixie/shared/api/maintenance';
import { getDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock, withMarketPublication } from '#infra/coordination/market-access.js';
import { acceptMarketPartition } from '#market/synchronization/records.js';
import { prepareMarketPartition, type SyncProviders } from '#market/synchronization/prepare.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { isObservationDate } from '#market/synchronization/date.js';
import {
  planSyncPartitions,
  SYNC_LIMITS,
  type SyncRequirements,
  type PlannedPartition,
} from './partitions.js';
import { readDatasetCoverage } from './status.js';
import { cleanRetiredSyncResources } from './resources.js';

export interface DataSyncInput {
  targetDate: string;
  startedAt: Date;
  providers: SyncProviders;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  /**
   * 测试可固定额外 ETF 同步对象。
   *
   * Tests can specify additional ETF synchronization objects.
   */
  requirements?: SyncRequirements;
  clock?: () => Date;
}

/**
 * 固定目标的一套有限流程；业务函数不关闭调用者数据库。
 *
 * One bounded flow with a fixed target; the caller owns database cleanup.
 */
export async function synchronizeData(input: DataSyncInput): Promise<DataSyncResult> {
  if (!isObservationDate(input.targetDate) || !Number.isFinite(input.startedAt.getTime())) {
    throw new Error('Invalid synchronization date/time');
  }

  input = {
    ...input,
    signal: AbortSignal.any([
      AbortSignal.timeout(SYNC_LIMITS.milliseconds),
      ...(input.signal ? [input.signal] : []),
    ]),
  };

  const sourceBudget = {
    failures: 0,
    lastFailure: undefined as string | undefined,
    remaining: SYNC_LIMITS.requests as number,
    deadline: Date.now() + SYNC_LIMITS.milliseconds,
    signal: input.signal,
  };

  return withSourceRequestBudget(sourceBudget, () =>
    withMaintenanceLock(async () => {
      const database = getDatabase();
      const clock = input.clock ?? (() => new Date());
      const log = input.onLog ?? console.log;
      const runId = ulid();
      const result: DataSyncResult = {
        runId,
        targetDate: input.targetDate,
        status: 'complete',
        partitions: 0,
        accepted: { inserted: 0, updated: 0, deleted: 0, rejected: 0 },
        coverage: [],
        gaps: [],
        errors: [],
      };
      const legacy = await database.maintenanceState.findUnique({
        where: { key: 'global' },
        select: { dataRevision: true },
      });
      await database.marketDataState.upsert({
        where: { key: 'global' },
        create: { key: 'global', revision: legacy?.dataRevision ?? 0 },
        update: {},
      });
      await database.dataSyncRun.updateMany({
        where: { status: 'running' },
        data: {
          status: 'interrupted',
          stage: 'interrupted',
          finishedAt: clock(),
          error: 'Writer ownership was released before terminal recording',
        },
      });
      await database.dataSyncRun.create({
        data: {
          id: runId,
          targetDate: input.targetDate,
          status: 'running',
          stage: 'planning',
          startedAt: input.startedAt,
        },
      });
      let heartbeat = Promise.resolve();
      const timer = setInterval(() => {
        heartbeat = heartbeat
          .then(async () => {
            await database.dataSyncRun.update({
              where: { id: runId },
              data: { heartbeatAt: clock() },
            });
          })
          .catch((error: unknown) => {
            result.errors.push(`Heartbeat: ${String(error)}`);
          });
      }, 15_000);
      timer.unref();
      try {
        result.gaps.push(...(await cleanRetiredSyncResources()));
        await retireDatasets();
        await acquireSyncPartitions(input, result, sourceBudget, clock, log);
        await normalizeSyncIdentities(result, clock, input.signal);
        result.gaps.push(...(await cleanRetiredSyncResources()));
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        clearInterval(timer);
        await heartbeat;
      }
      await finishSyncRun(result, clock);

      return result;
    }),
  );
}

async function acquireSyncPartitions(
  input: DataSyncInput,
  result: DataSyncResult,
  sourceBudget: SourceRequestBudget & { failures: number },
  clock: () => Date,
  log: (line: string) => void,
): Promise<void> {
  const database = getDatabase();
  const runId = result.runId;
  const attempted = new Set<string>();
  let requests = 0;
  const source = {
    async call(...args: Parameters<SyncProviders['source']['call']>) {
      if (input.signal?.aborted) {
        throw input.signal.reason ?? new Error('Synchronization cancelled');
      }
      if (requests >= SYNC_LIMITS.requests) {
        throw new MarketSyncBudgetError();
      }
      requests++;

      return input.providers.source.call(...args);
    },
  };
  const requirements = input.requirements ?? { etfCodes: [] };
  // 参考资料提交后重新读取对象清单，因此空库同一流程能够开始后续数据域。
  // Re-read inventories after reference commits so an empty database can start dependent domains in the same flow.
  for (let wave = 0; wave < 3 && result.partitions < SYNC_LIMITS.partitions; wave++) {
    const plan = await planSyncPartitions({
      targetDate: input.targetDate,
      startedAt: input.startedAt,
      requirements,
      budget: SYNC_LIMITS.partitions - result.partitions,
      excludeIds: attempted,
      deadline: sourceBudget.deadline,
    });
    result.gaps.push(...plan.gaps);
    const partitions = plan.partitions.filter((partition) => !attempted.has(partition.id));
    if (!partitions.length) {
      break;
    }
    for (const partition of partitions) {
      if (
        input.signal?.aborted ||
        Date.now() >= sourceBudget.deadline ||
        requests >= SYNC_LIMITS.requests ||
        sourceBudget.remaining <= 0
      ) {
        result.gaps.push('Finite run budget exhausted; durable partitions remain pending');
        break;
      }
      attempted.add(partition.id);
      result.partitions++;
      const fetchedAt = clock();
      const failuresBefore = sourceBudget.failures;
      log(
        `[data sync] ${partition.dataset}/${partition.scope} ${partition.startDate}..${partition.endDate}`,
      );
      await database.dataSyncRun.update({
        where: { id: runId },
        data: { stage: `${partition.dataset}:${partition.scope}` },
      });
      try {
        const prepared = await prepareMarketPartition(
          { ...input.providers, source },
          partition,
          fetchedAt,
        );
        if (prepared.status === 'waiting' && sourceBudget.failures > failuresBefore) {
          prepared.errors.push(
            sourceBudget.lastFailure ?? 'Source failed before the finite budget was exhausted',
          );
        }
        const committed = await publishSyncPartition(partition, prepared, runId, fetchedAt);
        for (const field of ['inserted', 'updated', 'deleted', 'rejected'] as const) {
          result.accepted[field] += committed.accepted[field];
        }
        result.errors.push(
          ...committed.errors.map((error) => `${partition.dataset}/${partition.scope}: ${error}`),
        );
        result.gaps.push(...committed.gaps);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const deferred =
          sourceBudget.failures === failuresBefore &&
          (error instanceof MarketSyncBudgetError ||
            sourceBudget.remaining <= 0 ||
            Boolean(input.signal?.aborted));
        (deferred ? result.gaps : result.errors).push(
          `${partition.dataset}/${partition.scope}: ${message}`,
        );
        await recordPartitionFailure(partition, runId, fetchedAt, message, deferred);
      }
    }
  }
}

/**
 * 单分区的原始数据、覆盖、版本与失效共同发布，提交完成后才向运行摘要累计。
 *
 * Publish one partition's data, coverage, revision and invalidation atomically before counting it.
 */
async function publishSyncPartition(
  partition: PlannedPartition,
  prepared: PreparedMarketPartition,
  runId: string,
  fetchedAt: Date,
) {
  const database = getDatabase();
  return withMarketPublication(async () =>
    database.$transaction(
      async (transaction) => {
        const accepted = await acceptMarketPartition(
          transaction,
          prepared,
          partition.dataset,
          fetchedAt,
        );
        const errors = [...prepared.errors, ...accepted.errors];
        const status = errors.length ? 'error' : prepared.status;
        const verified = status === 'complete' || status === 'not_applicable';
        const previous = await transaction.datasetSyncPartition.findUniqueOrThrow({
          where: { id: partition.id },
        });
        const policy = DATASET_POLICIES.find((entry) => entry.dataset === partition.dataset)!;
        const attempts = previous.attempts + 1;
        const delay =
          status === 'error'
            ? Math.min(
                7 * 86400_000,
                [300_000, 1800_000, 7200_000, 86400_000][Math.min(attempts - 1, 3)],
              )
            : status === 'complete' || status === 'not_applicable'
              ? policy.refreshDays * 86400_000
              : 1800_000;
        await transaction.datasetSyncPartition.update({
          where: { id: partition.id },
          data: {
            status,
            ...(verified ? { policyVersion: partition.policyVersion } : {}),
            attempts,
            lastRunId: runId,
            lastAttemptAt: fetchedAt,
            nextAttemptAt: new Date(fetchedAt.getTime() + delay),
            checkedAt:
              status === 'complete' || status === 'not_applicable' ? fetchedAt : previous.checkedAt,
            evidence: prepared.evidence,
            gaps: prepared.gaps,
            error: errors.join('\n') || null,
          },
        });
        const changed = accepted.changes.length > 0;
        const eligibilityChanged =
          previous.status !== status ||
          (verified && previous.policyVersion !== partition.policyVersion);
        const state = await transaction.datasetSyncState.findUniqueOrThrow({
          where: {
            dataset_scope: { dataset: partition.dataset, scope: partition.scope },
          },
        });
        const observed =
          [...accepted.observedDates, state.maxObservedDate ?? ''].sort().at(-1) || null;
        await transaction.datasetSyncState.update({
          where: {
            dataset_scope: { dataset: partition.dataset, scope: partition.scope },
          },
          data: {
            lastCheckedAt: fetchedAt,
            maxObservedDate: observed,
            revision: { increment: changed ? 1 : 0 },
            ...(verified ? { policyVersion: partition.policyVersion } : {}),
          },
        });
        if (changed || eligibilityChanged) {
          await transaction.marketDataState.update({
            where: { key: 'global' },
            data: { revision: { increment: 1 } },
          });
        }
        await updateVerifiedCoverage(transaction, partition.dataset, partition.scope);

        return {
          accepted,
          errors: status === 'waiting' ? [] : errors,
          gaps: [...prepared.gaps, ...(status === 'waiting' ? errors : [])],
        };
      },
      { timeout: 120_000 },
    ),
  );
}

async function recordPartitionFailure(
  partition: PlannedPartition,
  runId: string,
  fetchedAt: Date,
  message: string,
  deferred: boolean,
): Promise<void> {
  const database = getDatabase();
  await withMarketPublication(() =>
    database.$transaction(async (transaction) => {
      const previous = await transaction.datasetSyncPartition.findUniqueOrThrow({
        where: { id: partition.id },
      });
      await transaction.datasetSyncPartition.update({
        where: { id: partition.id },
        data: {
          status: deferred ? 'waiting' : 'error',
          attempts: { increment: 1 },
          lastRunId: runId,
          lastAttemptAt: fetchedAt,
          nextAttemptAt: new Date(fetchedAt.getTime() + 300_000),
          error: message,
        },
      });
      await transaction.datasetSyncState.update({
        where: {
          dataset_scope: { dataset: partition.dataset, scope: partition.scope },
        },
        data: { lastCheckedAt: fetchedAt },
      });
      if (previous.status === 'complete' || previous.status === 'not_applicable') {
        await transaction.marketDataState.update({
          where: { key: 'global' },
          data: { revision: { increment: 1 } },
        });
        await updateVerifiedCoverage(transaction, partition.dataset, partition.scope);
      }
    }),
  );
}

async function normalizeSyncIdentities(
  result: DataSyncResult,
  clock: () => Date,
  signal?: AbortSignal,
): Promise<void> {
  const database = getDatabase();
  for (const change of STOCK_CODE_CHANGES) {
    if (signal?.aborted) {
      result.gaps.push('Identity normalization deferred by the run budget');
      break;
    }
    try {
      const committed = await withMarketPublication(() =>
        database.$transaction(
          async (transaction) => {
            const prepared = await prepareIdentityNormalization(transaction, change);
            const accepted = await acceptMarketPartition(
              transaction,
              prepared,
              'identity-normalization',
              clock(),
            );
            if (accepted.changes.length) {
              await transaction.marketDataState.update({
                where: { key: 'global' },
                data: { revision: { increment: 1 } },
              });
            }
            return accepted;
          },
          { timeout: 120_000 },
        ),
      );
      result.accepted.inserted += committed.inserted;
      result.accepted.updated += committed.updated;
      result.accepted.deleted += committed.deleted;
      result.accepted.rejected += committed.rejected;
      result.errors.push(...committed.errors);
    } catch (error) {
      result.errors.push(`Identity normalization ${change.oldTsCode}: ${String(error)}`);
    }
  }
}

async function finishSyncRun(result: DataSyncResult, clock: () => Date): Promise<void> {
  const database = getDatabase();
  const runId = result.runId;

  result.coverage = await readDatasetCoverage();
  const unfinished = await database.datasetSyncPartition.count({
    where: {
      endDate: { lte: result.targetDate },
      status: { notIn: ['complete', 'not_applicable'] },
    },
  });
  const unresolved = await database.datasetSyncPartition.findMany({
    where: { status: 'error', endDate: { lte: result.targetDate } },
    select: { dataset: true, scope: true, error: true },
  });
  result.errors.push(
    ...unresolved.map((entry) => `${entry.dataset}/${entry.scope}: ${entry.error}`),
  );
  if (unfinished) {
    result.gaps.push(`${unfinished} unfinished source partitions`);
  }
  result.errors = [...new Set(result.errors)];
  result.gaps = [...new Set(result.gaps)];
  result.status = result.errors.length ? 'error' : result.gaps.length ? 'partial' : 'complete';
  await database.dataSyncRun.update({
    where: { id: runId },
    data: {
      status: result.status,
      stage: 'finished',
      heartbeatAt: clock(),
      finishedAt: clock(),
      summary: JSON.parse(JSON.stringify(result)),
      error: result.errors.join('\n') || null,
    },
  });
}
