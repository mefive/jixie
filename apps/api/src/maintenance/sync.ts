import { attemptSyncWindow } from './attempt.js';
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
import { isObservationDate, localDate } from '#market/synchronization/date.js';
import type { SyncProviders } from '#market/synchronization/prepare.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { withSourceRequestBudget } from '#market/providers/source-fetch.js';
import { SYNC_LIMITS } from './partitions.js';
import { startSyncRun, finishSyncRun } from './runs.js';
import { reconcileSyncRules } from './reconcile.js';
import { retireDatasets } from './retired-datasets.js';

export interface DataSyncInput {
  targetDate: string;
  startedAt: Date;
  providers: SyncProviders;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  clock?: () => Date;
}

/**
 * 固定目标、顺序领域调用和短事务提交；调用方负责数据库关闭。
 *
 * Use one fixed target and explicit domain calls; the caller owns database cleanup.
 */
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
      const initialized = await startSyncRun(input.targetDate, input.startedAt, clock());
      const result = initialized.result;
      let nextIndex = initialized.nextIndex;
      const attempted = new Set<string>();

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
        const resumeIndex = referenceStage ? nextIndex : (index + 1) % DATASET_POLICIES.length;
        const acquired = await attemptSyncWindow({
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
          resumeDataset: DATASET_POLICIES[resumeIndex].dataset,
        });
        if (acquired && !referenceStage) {
          nextIndex = resumeIndex;
        }

        return acquired;
      };

      try {
        await retireDatasets();
        await reconcileSyncRules();
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

        await normalizeRetainedStockHistory(result);

        for (const dataset of ['calendar', 'stock-master', 'etf-master']) {
          const index = DATASET_POLICIES.findIndex((policy) => policy.dataset === dataset);
          while (!exhausted() && (await acquire(index, false))) {
            /*
             * 每次只推进一个参考窗口。
             *
             * Advance one reference window at a time.
             */
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
      } catch (error) {
        result.errors.push(String(error));
      } finally {
        clearInterval(timer);
        await heartbeat;
      }

      if (exhausted()) {
        result.gaps.push('Finite run budget exhausted; remaining windows resume next run');
      }

      await finishSyncRun(result, nextIndex, input.startedAt, clock());

      return result;
    }),
  );
}

/**
 * 证券接续属于必要维护，不受网络回补预算限制。
 *
 * Identity maintenance is independent of the download budget.
 */
async function normalizeRetainedStockHistory(result: DataSyncResult): Promise<void> {
  const database = getDatabase();
  for (const change of STOCK_CODE_CHANGES) {
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
}
