import type { MarketTransaction } from '../synchronization/partition.js';
import type { CleanupItem, PreparedCleanup } from '../synchronization/cleanup.js';
import { STOCK_CODE_CHANGES } from '../instruments/stock-identity.js';

/**
 * 从未上市的目录仅在没有历史、来源身份或同步引用时可由人工删除。
 *
 * Manual removal of never-listed metadata requires no history, source identity or sync references.
 */
export async function preparePendingStockCleanup(
  transaction: MarketTransaction,
): Promise<PreparedCleanup> {
  const pending = await transaction.stockBasic.findMany({
    where: { listStatus: { in: ['G', 'UN'] } },
    orderBy: { tsCode: 'asc' },
  });
  const items: CleanupItem[] = [];
  const retained: CleanupItem[] = [];
  for (const row of pending) {
    const where = { OR: [{ tsCode: row.tsCode }, { sourceTsCode: row.tsCode }] };
    const references = await Promise.all([
      transaction.daily.count({ where }),
      transaction.adjFactor.count({ where }),
      transaction.dailyBasic.count({ where }),
      transaction.stkLimit.count({ where }),
      transaction.stockNameHistory.count({ where }),
      transaction.finaIndicator.count({ where }),
      transaction.finaIndicatorVersion.count({ where }),
      transaction.financialIncomeStatement.count({ where }),
      transaction.financialBalanceSheet.count({ where }),
      transaction.financialCashFlowStatement.count({ where }),
      transaction.dividend.count({ where }),
      transaction.financialCorrectionEvidence.count({ where: { tsCode: row.tsCode } }),
      transaction.indexWeight.count({
        where: { OR: [{ conCode: row.tsCode }, { sourceTsCode: row.tsCode }] },
      }),
      transaction.stockCodeChange.count({
        where: { OR: [{ oldTsCode: row.tsCode }, { newTsCode: row.tsCode }] },
      }),
      transaction.datasetSyncState.count({ where: { scope: row.tsCode } }),
      transaction.datasetSyncPartition.count({ where: { scope: row.tsCode } }),
    ]);
    const reasons: string[] = [];
    if (row.listDate || row.delistDate) {
      reasons.push('Listing dates contradict never-listed status');
    }
    if (
      references.some(Boolean) ||
      STOCK_CODE_CHANGES.some(
        (change) => change.oldTsCode === row.tsCode || change.newTsCode === row.tsCode,
      )
    ) {
      reasons.push('Historical data, source identity or synchronization references exist');
    }
    const item = { table: 'StockBasic', code: row.tsCode, count: 1 };
    if (reasons.length) {
      retained.push({ ...item, reason: reasons.join('; ') });
    } else {
      items.push({ ...item, reason: 'Unreferenced never-listed stock' });
    }
  }

  return {
    items,
    retained,
    coverage: [],
    apply: async () => {
      const result = await transaction.stockBasic.deleteMany({
        where: { tsCode: { in: items.map((item) => item.code!) }, listStatus: { in: ['G', 'UN'] } },
      });
      if (result.count !== items.length) {
        throw new Error('Pending stock cleanup changed during inspection');
      }

      return result.count;
    },
  };
}
