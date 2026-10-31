import type { Prisma } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock, withMarketPublication } from '#infra/coordination/market-access.js';
import { preparePendingEtfCleanup } from '#market/etfs/cleanup-pending.js';
import { prepareIdentityCleanup } from '#market/instruments/cleanup-identity.js';
import { prepareMarketRangeCleanup } from '#market/stocks/cleanup-range.js';
import { updateVerifiedCoverage } from '#market/synchronization/coverage.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import type { CleanupCoverage, CleanupItem } from '#market/synchronization/cleanup.js';
import type { MarketTransaction } from '#market/synchronization/partition.js';
import { prepareRetiredCleanup } from './retired-datasets.js';
import type { DataCleanupInput } from './cleanup-request.js';

/**
 * 人工清理默认预览；持维护锁备份，发布事务内重查、修改和撤销资格。
 *
 * Manual cleanup defaults to preview; back up under ownership, then recheck and publish atomically.
 */
export async function cleanData(input: DataCleanupInput) {
  if (input.apply && !input.backup) {
    throw new Error('Cleanup requires a verified backup before applying changes');
  }

  return withMaintenanceLock(async () => {
    input.signal?.throwIfAborted();
    const database = getDatabase();
    const preview = await database.$transaction(
      (transaction) => processCleanup(transaction, false),
      { timeout: 120_000 },
    );
    const result = {
      mode: input.apply ? 'apply' : 'preview',
      ...preview,
      invalidatedPartitions: 0,
      backup: null as string | null,
    };
    if (!input.apply || !preview.items.length) {
      return result;
    }

    input.signal?.throwIfAborted();
    result.backup = await input.backup!();
    input.signal?.throwIfAborted();

    return withMarketPublication(() =>
      database.$transaction(
        async (transaction) => {
          const cleaned = await processCleanup(transaction, true);
          const { changed, coverage } = cleaned;
          const invalidatedPartitions = changed
            ? await invalidateCleanedCoverage(transaction, coverage)
            : 0;
          if (changed) {
            await transaction.marketDataState.upsert({
              where: { key: 'global' },
              create: { key: 'global', revision: 1 },
              update: { revision: { increment: 1 } },
            });
          }
          input.signal?.throwIfAborted();

          return {
            ...result,
            ...cleaned,
            invalidatedPartitions,
          };
        },
        { timeout: 120_000 },
      ),
    );
  });
}

/**
 * 固定顺序检查所有类别；执行时逐类重查，共享一个事务及备份。
 *
 * Inspect every category in a fixed order; recheck each application
 * within one transaction and backup.
 */
async function processCleanup(transaction: MarketTransaction, apply: boolean) {
  const categories = [
    { category: 'pending-etfs', prepare: () => preparePendingEtfCleanup(transaction) },
    { category: 'retired-data', prepare: () => prepareRetiredCleanup(transaction) },
    { category: 'stock-identities', prepare: () => prepareIdentityCleanup(transaction) },
    { category: 'market-range', prepare: () => prepareMarketRangeCleanup(transaction) },
  ];
  const items: Array<CleanupItem & { category: string }> = [];
  const retained: Array<CleanupItem & { category: string }> = [];
  const coverage: CleanupCoverage[] = [];
  const summary: Array<{
    category: string;
    candidates: number;
    retained: number;
    changed: number;
  }> = [];
  let changed = 0;

  for (const { category, prepare } of categories) {
    const plan = await prepare();
    const count = apply && plan.items.length ? await plan.apply() : 0;
    items.push(...plan.items.map((item) => ({ category, ...item })));
    retained.push(...plan.retained.map((item) => ({ category, ...item })));
    if (!apply || count) {
      coverage.push(...plan.coverage);
    }
    summary.push({
      category,
      candidates: plan.items.reduce((total, item) => total + item.count, 0),
      retained: plan.retained.reduce((total, item) => total + item.count, 0),
      changed: count,
    });
    changed += count;
  }

  return { summary, items, retained, coverage, changed };
}

/**
 * 清理不能产生完成凭证；保留失败证据并从剩余有效窗口重新计算连续覆盖。
 *
 * Cleanup never certifies completion; retain failures and recompute coverage from surviving proofs.
 */
async function invalidateCleanedCoverage(
  transaction: MarketTransaction,
  coverage: CleanupCoverage[],
): Promise<number> {
  if (!coverage.length) {
    return 0;
  }
  const scopes = coverage.map(({ dataset, scope }) => ({ dataset, ...(scope ? { scope } : {}) }));
  const ranges: Prisma.DatasetSyncPartitionWhereInput[] = coverage.map((extent) => ({
    dataset: extent.dataset,
    ...(extent.scope ? { scope: extent.scope } : {}),
    ...(extent.to ? { startDate: { lte: extent.to } } : {}),
    ...(extent.from ? { endDate: { gte: extent.from } } : {}),
  }));
  const invalidated = await transaction.datasetSyncPartition.updateMany({
    where: { OR: ranges, status: { in: ['complete', 'not_applicable', 'unavailable'] } },
    data: {
      status: 'partial',
      checkedAt: null,
      error: null,
      gaps: ['Manual cleanup requires source revalidation'],
    },
  });
  const states = await transaction.datasetSyncState.findMany({ where: { OR: scopes } });
  for (const state of states) {
    const policy = DATASET_POLICIES.find((entry) => entry.dataset === state.dataset);
    if (policy) {
      await updateVerifiedCoverage(transaction, state.dataset, state.scope, policy.startDate);
    }
  }

  // 删除日数据后，最大观察日也必须回到实际存储事实。
  // After daily-row deletion, maximum observation dates must reflect remaining stored values.
  if (coverage.some((extent) => extent.dataset === 'stock-prices')) {
    const maxima = await Promise.all([
      transaction.daily.aggregate({ _max: { tradeDate: true } }),
      transaction.adjFactor.aggregate({ _max: { tradeDate: true } }),
      transaction.dailyBasic.aggregate({ _max: { tradeDate: true } }),
      transaction.stkLimit.aggregate({ _max: { tradeDate: true } }),
    ]);
    const datasets = ['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'];
    for (const [index, dataset] of datasets.entries()) {
      await transaction.datasetSyncState.updateMany({
        where: { dataset, scope: 'all' },
        data: { maxObservedDate: maxima[index]._max.tradeDate },
      });
    }
  }

  return invalidated.count;
}
