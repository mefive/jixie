import type { MarketTransaction } from '../synchronization/partition.js';
import type { CleanupCoverage, CleanupItem, PreparedCleanup } from '../synchronization/cleanup.js';
import { STOCK_CODE_CHANGES } from './stock-identity.js';
import { normalizeStockIdentity } from './normalize-identity.js';

const IDENTITY_TABLES = [
  ['Daily', 'stock-prices'],
  ['AdjFactor', 'stock-adjustments'],
  ['DailyBasic', 'stock-valuations'],
  ['StkLimit', 'stock-limits'],
  ['StockNameHistory', 'stock-names'],
  ['FinaIndicator', 'financial-indicators'],
  ['FinaIndicatorVersion', 'financial-indicators'],
  ['FinancialIncomeStatement', 'financial-statements'],
  ['FinancialBalanceSheet', 'financial-statements'],
  ['FinancialCashFlowStatement', 'financial-statements'],
  ['Dividend', 'dividends'],
  ['IndexWeight', 'index-weights'],
] as const;

/**
 * 预览旧身份涉及的记录；新旧冲突按既有来源优先规则在发布事务内处理。
 *
 * Preview stored predecessor rows; resolve collisions with the existing source policy atomically.
 */
export async function prepareIdentityCleanup(
  transaction: MarketTransaction,
): Promise<PreparedCleanup> {
  const changes = STOCK_CODE_CHANGES;
  const items: CleanupItem[] = [];
  const selected: Array<(typeof changes)[number]> = [];
  const coverage = new Map<string, CleanupCoverage>();

  for (const change of changes) {
    const where = { tsCode: change.oldTsCode };
    const counts = await Promise.all([
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
      transaction.indexWeight.count({ where: { conCode: change.oldTsCode } }),
    ]);
    if (!counts.some(Boolean)) {
      continue;
    }

    await normalizeStockIdentity(transaction, change, { preview: true });
    selected.push(change);
    for (const [index, count] of counts.entries()) {
      if (count) {
        const [table, dataset] = IDENTITY_TABLES[index];
        items.push({
          table,
          code: change.oldTsCode,
          count,
          reason: `Merge into ${change.newTsCode}; prefer newer source`,
          source: change.source,
        });
        if (dataset === 'dividends') {
          for (const scope of [change.oldTsCode, change.newTsCode]) {
            coverage.set(`${dataset}/${scope}`, { dataset, scope });
          }
        } else {
          coverage.set(dataset, { dataset });
        }
      }
    }
  }

  if (coverage.has('stock-prices')) {
    for (const dataset of ['stock-adjustments', 'stock-valuations', 'stock-limits']) {
      coverage.set(dataset, { dataset });
    }
  }

  return {
    items,
    retained: [],
    coverage: [...coverage.values()],
    apply: async () => {
      let changed = 0;
      for (const change of selected) {
        const result = await normalizeStockIdentity(transaction, change);
        changed += result.updated + result.deleted;
      }

      return changed;
    },
  };
}
