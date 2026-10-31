import { z } from 'zod';
import type { MarketTransaction } from '../synchronization/partition.js';
import type { PreparedCleanup } from '../synchronization/cleanup.js';

interface PendingEtfCleanup {
  removableCodes: string[];
  protectedRows: Array<{ tsCode: string; reasons: string[] }>;
}

/**
 * 只清理无业务依赖的待上市目录；同步状态和旧历史标记也视作保留依据。
 *
 * Remove only unreferenced pending metadata; sync state and legacy history markers also protect it.
 */
async function inspectPendingEtfs(transaction: MarketTransaction): Promise<PendingEtfCleanup> {
  const pending = await transaction.etfBasic.findMany({
    where: { listStatus: 'P' },
    select: { tsCode: true, listDate: true },
    orderBy: { tsCode: 'asc' },
  });
  const codes = pending.map((row) => row.tsCode);
  if (!codes.length) {
    return { removableCodes: [], protectedRows: [] };
  }

  const [prices, adjustments, sizes, slices, states, partitions, lists] = await Promise.all([
    transaction.etfDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: codes } },
    }),
    transaction.etfAdjFactor.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: codes } },
    }),
    transaction.etfLatestSize.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true },
    }),
    transaction.etfSyncSlice.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: codes } },
    }),
    transaction.datasetSyncState.groupBy({
      by: ['scope'],
      where: { dataset: { in: ['etf-prices', 'etf-adjustments'] }, scope: { in: codes } },
    }),
    transaction.datasetSyncPartition.groupBy({
      by: ['scope'],
      where: { dataset: { in: ['etf-prices', 'etf-adjustments'] }, scope: { in: codes } },
    }),
    transaction.marketDownloadList.findMany({ select: { codes: true } }),
  ]);
  const references = [
    ['price history', new Set(prices.map((row) => row.tsCode))],
    ['adjustment history', new Set(adjustments.map((row) => row.tsCode))],
    ['size snapshot', new Set(sizes.map((row) => row.tsCode))],
    ['legacy history marker', new Set(slices.map((row) => row.tsCode))],
    ['sync state', new Set(states.map((row) => row.scope))],
    ['sync partition', new Set(partitions.map((row) => row.scope))],
    ['download list', new Set(lists.flatMap((row) => z.array(z.string()).parse(row.codes)))],
  ] as const;
  const result: PendingEtfCleanup = { removableCodes: [], protectedRows: [] };
  for (const row of pending) {
    const reasons: string[] = references
      .filter(([, known]) => known.has(row.tsCode))
      .map(([reason]) => reason);
    if (row.listDate) {
      reasons.push('pending entry already has a listing date');
    }
    if (reasons.length) {
      result.protectedRows.push({ tsCode: row.tsCode, reasons });
    } else {
      result.removableCodes.push(row.tsCode);
    }
  }

  return result;
}

/**
 * 检查待上市目录的所有引用；事务和修订发布由人工清理入口负责。
 *
 * Inspect every pending-directory reference; manual cleanup owns transactions and revisions.
 */
export async function preparePendingEtfCleanup(
  transaction: MarketTransaction,
): Promise<PreparedCleanup> {
  const plan = await inspectPendingEtfs(transaction);

  return {
    items: plan.removableCodes.map((tsCode) => ({
      table: 'EtfBasic',
      code: tsCode,
      count: 1,
      reason: 'Unreferenced pending ETF',
    })),
    retained: plan.protectedRows.map((row) => ({
      table: 'EtfBasic',
      code: row.tsCode,
      count: 1,
      reason: row.reasons.join('; '),
    })),
    coverage: [],
    apply: async () => {
      const result = await transaction.etfBasic.deleteMany({
        where: { listStatus: 'P', tsCode: { in: plan.removableCodes } },
      });
      if (result.count !== plan.removableCodes.length) {
        throw new Error('Pending ETF cleanup changed during inspection');
      }

      return result.count;
    },
  };
}
