import { ulid } from 'ulid';
import type { DataSyncResult } from '@jixie/shared/api/maintenance';
import { getDatabase } from '#infra/database/prisma.js';
import {
  cleanupOwnerLocks,
  withMaintenanceLock,
  withMarketPublication,
} from '#infra/coordination/market-access.js';
import { initializeIndexDownloads } from '#market/downloads/lists.js';
import { selectEtfsUnderMaintenance } from '#market/downloads/select-etfs.js';
import { normalizeStockIdentity } from '#market/instruments/normalize-identity.js';
import { STOCK_CODE_CHANGES } from '#market/instruments/stock-identity.js';
import { updateVerifiedCoverage } from '#market/synchronization/coverage.js';
import { isObservationDate, localDate } from '#market/synchronization/date.js';
import {
  prepareMarketPartition,
  writeMarketPartition,
  type SyncProviders,
} from '#market/synchronization/prepare.js';
import type { PreparedMarketPartition } from '#market/synchronization/partition.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { withSourceRequestBudget } from '#market/providers/source-fetch.js';
import { MarketSyncBudgetError } from '#market/errors.js';
import { selectSyncWindow, SYNC_LIMITS, type PlannedPartition } from './partitions.js';
import { readHistoryGaps, readDatasetCoverage } from './status.js';
import { retireDatasets } from './retired-datasets.js';

export interface DataSyncInput {
  targetDate: string;
  startedAt: Date;
  providers: SyncProviders;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  clock?: () => Date;
}

/** 固定目标、顺序领域调用和短事务提交；调用方负责数据库关闭。
 * Use one fixed target and explicit domain calls; the caller owns database cleanup. */
export async function synchronizeData(input: DataSyncInput): Promise<DataSyncResult> {
  if (!isObservationDate(input.targetDate) || !Number.isFinite(input.startedAt.getTime())) {
    throw new Error('Invalid synchronization date/time');
  }
  const signal = AbortSignal.any([
    AbortSignal.timeout(SYNC_LIMITS.milliseconds),
    ...(input.signal ? [input.signal] : []),
  ]);
  const budget = {
    remaining: SYNC_LIMITS.requests as number,
    deadline: Date.now() + SYNC_LIMITS.milliseconds,
    signal,
    failures: 0,
    lastFailure: undefined as string | undefined,
  };
  const clock = input.clock ?? (() => new Date());
  const log = input.onLog ?? console.log;

  return withSourceRequestBudget(budget, () =>
    withMaintenanceLock(async () => {
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
      let nextIndex = Math.max(
        0,
        DATASET_POLICIES.findIndex((policy) => policy.dataset === resume),
      );
      const result: DataSyncResult = {
        runId: ulid(),
        targetDate: input.targetDate,
        status: 'complete',
        partitions: 0,
        accepted: { inserted: 0, updated: 0, deleted: 0, rejected: 0 },
        coverage: [],
        gaps: [],
        errors: [],
      };
      const attempted = new Set<string>();

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
          finishedAt: clock(),
          error: 'Writer exited before terminal recording',
        },
      });
      await database.dataSyncRun.create({
        data: {
          id: result.runId,
          targetDate: input.targetDate,
          status: 'running',
          stage: 'references',
          startedAt: input.startedAt,
          summary: { resumeDataset: resume },
        },
      });
      await database.dataSyncRun.deleteMany({
        where: { id: { not: result.runId }, ...(previous ? { NOT: { id: previous.id } } : {}) },
      });

      const exhausted = () =>
        signal.aborted ||
        Date.now() >= budget.deadline ||
        budget.remaining <= 0 ||
        result.partitions >= SYNC_LIMITS.partitions;
      let heartbeat = Promise.resolve();
      const timer = setInterval(() => {
        heartbeat = heartbeat
          .then(async () => {
            await database.dataSyncRun.update({
              where: { id: result.runId },
              data: { heartbeatAt: clock() },
            });
          })
          .catch((error: unknown) => {
            result.errors.push(`Heartbeat: ${String(error)}`);
          });
      }, 15_000);
      timer.unref();

      let referenceStage = true;
      const acquire = async (index: number, history: boolean) => {
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
        log(
          `[data sync] ${partition.dataset}/${partition.scope} ${partition.startDate}..${partition.endDate}`,
        );
        await database.dataSyncRun.update({
          where: { id: result.runId },
          data: { stage: `${partition.dataset}:${partition.scope}` },
        });

        const failures = budget.failures;
        try {
          const prepared = await prepareMarketPartition(input.providers, partition, fetchedAt);
          if (prepared.status === 'waiting' && budget.failures > failures) {
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

        if (!referenceStage) {
          nextIndex = (index + 1) % DATASET_POLICIES.length;
        }
        await database.dataSyncRun.update({
          where: { id: result.runId },
          data: {
            heartbeatAt: clock(),
            summary: JSON.parse(
              JSON.stringify({ ...result, resumeDataset: DATASET_POLICIES[nextIndex].dataset }),
            ),
          },
        });

        return true;
      };

      try {
        await retireDatasets();
        await cleanupOwnerLocks(true);
        await initializeIndexDownloads();

        if (!(await database.marketDownloadList.findUnique({ where: { assetType: 'etf' } }))) {
          try {
            log(
              JSON.stringify(
                await selectEtfsUnderMaintenance({
                  source: input.providers.source,
                  today: localDate(input.startedAt),
                }),
              ),
            );
          } catch (error) {
            result.errors.push(`ETF initialization: ${String(error)}`);
          }
        }

        for (const dataset of ['calendar', 'stock-master', 'etf-master']) {
          const index = DATASET_POLICIES.findIndex((policy) => policy.dataset === dataset);
          while (!exhausted() && (await acquire(index, false))) {
            /* 每次只推进一个参考窗口。 / Advance one reference window at a time. */
          }
        }

        // 参考资料不覆盖上次保存的业务轮换位置。
        // Reference acquisition does not replace the saved business rotation position.
        referenceStage = false;

        while (!exhausted()) {
          let progressed = false;
          const start = nextIndex;
          for (let offset = 0; offset < DATASET_POLICIES.length && !exhausted(); offset++) {
            const index = (start + offset) % DATASET_POLICIES.length;
            progressed = (await acquire(index, false)) || progressed;
            progressed = (await acquire(index, true)) || progressed;
          }
          if (!progressed) {
            break;
          }
        }

        for (const change of STOCK_CODE_CHANGES) {
          if (exhausted()) {
            break;
          }
          try {
            const accepted = await withMarketPublication(() =>
              database.$transaction(
                async (transaction) => {
                  const written = await normalizeStockIdentity(transaction, change);
                  if (written.changed) {
                    await transaction.marketDataState.update({
                      where: { key: 'global' },
                      data: { revision: { increment: 1 } },
                    });
                  }

                  return written;
                },
                { timeout: 120_000 },
              ),
            );
            for (const field of ['inserted', 'updated', 'deleted', 'rejected'] as const) {
              result.accepted[field] += accepted[field];
            }
          } catch (error) {
            result.errors.push(`Identity normalization ${change.oldTsCode}: ${String(error)}`);
          }
        }
      } catch (error) {
        result.errors.push(String(error));
      } finally {
        clearInterval(timer);
        await heartbeat;
      }

      if (exhausted()) {
        result.gaps.push('Finite run budget exhausted; remaining windows resume next run');
      }

      result.coverage = await readDatasetCoverage();
      for (const coverage of result.coverage) {
        if (coverage.pending) {
          result.gaps.push(
            `${coverage.dataset}: ${coverage.pending} attempted windows remain incomplete`,
          );
        }
        if (coverage.errors) {
          result.errors.push(`${coverage.dataset}: ${coverage.errors} source windows have errors`);
        }
      }

      result.gaps.push(...(await readHistoryGaps(input.targetDate, input.startedAt)));
      result.errors = [...new Set(result.errors)];
      result.gaps = [...new Set(result.gaps)];
      result.status = result.errors.length ? 'error' : result.gaps.length ? 'partial' : 'complete';

      await database.dataSyncRun.update({
        where: { id: result.runId },
        data: {
          status: result.status,
          stage: 'finished',
          finishedAt: clock(),
          heartbeatAt: clock(),
          error: result.errors.join('\n') || null,
          summary: JSON.parse(
            JSON.stringify({ ...result, resumeDataset: DATASET_POLICIES[nextIndex].dataset }),
          ),
        },
      });

      return result;
    }),
  );
}

async function recordAttempt(partition: PlannedPartition, runId: string, fetchedAt: Date) {
  const database = getDatabase();
  const { id, dataset, scope, startDate, endDate, policyVersion } = partition;
  await database.$transaction(async (transaction) => {
    await transaction.datasetSyncPartition.upsert({
      where: { id },
      create: {
        id,
        dataset,
        scope,
        startDate,
        endDate,
        policyVersion,
        status: 'pending',
        lastRunId: runId,
        lastAttemptAt: fetchedAt,
      },
      update: { lastRunId: runId, lastAttemptAt: fetchedAt },
    });
    await transaction.datasetSyncState.upsert({
      where: { dataset_scope: { dataset, scope } },
      create: {
        dataset,
        scope,
        lastCheckedAt: fetchedAt,
        ...(partition.history ? { lastBackfillAt: fetchedAt } : {}),
      },
      update: {
        lastCheckedAt: fetchedAt,
        ...(partition.history ? { lastBackfillAt: fetchedAt } : {}),
      },
    });
  });
}

/** 原始值、窗口资格、覆盖和修订号在同一短事务发布。 / Publish values, eligibility, coverage and revision atomically. */
async function publishWindow(
  partition: PlannedPartition,
  prepared: PreparedMarketPartition,
  runId: string,
  fetchedAt: Date,
) {
  const database = getDatabase();

  return withMarketPublication(() =>
    database.$transaction(
      async (transaction) => {
        const accepted = await writeMarketPartition(transaction, prepared, partition, fetchedAt);
        const errors = [...prepared.errors, ...accepted.errors];
        const status = errors.length ? 'error' : prepared.status;
        const verified = status === 'complete' || status === 'not_applicable';
        const previous = await transaction.datasetSyncPartition.findUniqueOrThrow({
          where: { id: partition.id },
        });

        // 重叠旧窗口不能掩盖这次发现的缺口；恢复时只认覆盖该范围的完整结果。
        // Old overlapping windows cannot mask a newly observed gap; restore only proven complete extents.
        const overlapping = await transaction.datasetSyncPartition.updateMany({
          where: {
            dataset: partition.dataset,
            scope: partition.scope,
            id: { not: partition.id },
            ...(verified
              ? {
                  startDate: { gte: partition.startDate },
                  endDate: { lte: partition.endDate },
                  status: { notIn: ['complete', 'not_applicable'] },
                }
              : {
                  startDate: { lte: partition.endDate },
                  endDate: { gte: partition.startDate },
                  policyVersion: partition.policyVersion,
                  status: { in: ['complete', 'not_applicable'] },
                }),
          },
          data: {
            status: verified ? 'complete' : 'partial',
            policyVersion: partition.policyVersion,
            error: verified ? null : 'Overlapping source window needs verification',
            gaps: verified ? [] : ['Overlapping source window needs verification'],
            ...(verified ? { checkedAt: fetchedAt } : {}),
          },
        });
        await transaction.datasetSyncPartition.update({
          where: { id: partition.id },
          data: {
            status,
            policyVersion: verified ? partition.policyVersion : previous.policyVersion,
            lastRunId: runId,
            lastAttemptAt: fetchedAt,
            checkedAt: verified ? fetchedAt : previous.checkedAt,
            gaps: prepared.gaps,
            error: errors.join('\n') || null,
          },
        });

        const state = await transaction.datasetSyncState.findUniqueOrThrow({
          where: { dataset_scope: { dataset: partition.dataset, scope: partition.scope } },
        });
        await transaction.datasetSyncState.update({
          where: { dataset_scope: { dataset: partition.dataset, scope: partition.scope } },
          data: {
            maxObservedDate:
              [...accepted.observedDates, state.maxObservedDate ?? ''].sort().at(-1) || null,
          },
        });
        await updateVerifiedCoverage(transaction, partition.dataset, partition.scope);

        const previouslyVerified =
          ['complete', 'not_applicable'].includes(previous.status) &&
          previous.policyVersion === partition.policyVersion;
        if (accepted.changed || overlapping.count > 0 || previouslyVerified !== verified) {
          await transaction.marketDataState.update({
            where: { key: 'global' },
            data: { revision: { increment: 1 } },
          });
        }

        return { accepted, errors };
      },
      { timeout: 120_000 },
    ),
  );
}
