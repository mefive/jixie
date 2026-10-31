import { canonicalStockCode } from '../instruments/stock-identity.js';
import type { MarketTransaction } from '../synchronization/partition.js';
import type { PreparedCleanup } from '../synchronization/cleanup.js';
import { isOutsideStockLimitScope } from './limit-scope.js';

/**
 * 人工清理复用入库的身份规则；只删除明确范围外的限价，不触碰未知证券。
 *
 * Manual cleanup shares ingestion identity rules.
 * Remove proven exclusions without touching unknown identities.
 */
export async function prepareStockLimitScopeCleanup(
  transaction: MarketTransaction,
): Promise<PreparedCleanup> {
  const [stockRows, fundRows, groups] = await Promise.all([
    transaction.stockBasic.findMany({ select: { tsCode: true } }),
    transaction.etfBasic.findMany({ select: { tsCode: true } }),
    transaction.stkLimit.groupBy({
      by: ['tsCode'],
      _min: { tradeDate: true },
      _max: { tradeDate: true },
      _count: true,
    }),
  ]);
  const stocks = new Set(stockRows.map((row) => canonicalStockCode(row.tsCode)));
  const funds = new Set(fundRows.map((row) => row.tsCode));
  const outside = groups.filter((row) => isOutsideStockLimitScope(row.tsCode, stocks, funds));
  const codes = outside.map((row) => row.tsCode);
  const dates = codes.length
    ? await transaction.stkLimit.findMany({
        where: { tsCode: { in: codes } },
        select: { tradeDate: true },
        distinct: ['tradeDate'],
        orderBy: { tradeDate: 'asc' },
      })
    : [];

  return {
    items: outside.map((row) => ({
      table: 'StkLimit',
      code: row.tsCode,
      count: row._count,
      from: row._min.tradeDate!,
      to: row._max.tradeDate!,
      reason: 'Confirmed ETF or B-share identity outside stock maintenance',
    })),
    retained: [],
    coverage: dates.map(({ tradeDate }) => ({
      dataset: 'stock-limits',
      scope: 'all',
      from: tradeDate,
      to: tradeDate,
    })),
    apply: async () => {
      const result = await transaction.stkLimit.deleteMany({
        where: { tsCode: { in: codes } },
      });

      return result.count;
    },
  };
}
