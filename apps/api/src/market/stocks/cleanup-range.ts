import type { MarketTransaction } from '../synchronization/partition.js';
import type { CleanupItem, PreparedCleanup } from '../synchronization/cleanup.js';
import { confirmedMarketStart, stockMarketRanges } from '../instruments/market-range.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { prepareStockLimitScopeCleanup } from './cleanup-limit-scope.js';

interface DailyFilter {
  tsCode?: string;
  tradeDate?: { gte?: string; lte?: string; lt?: string; gt?: string };
  OR?: DailyFilter[];
}

/**
 * 只清理有市场边界证据的四类股票日数据；其他越界记录保留并逐项报告。
 *
 * Clean four stock daily datasets only with market-boundary evidence; report other outliers intact.
 */
export async function prepareMarketRangeCleanup(
  transaction: MarketTransaction,
): Promise<PreparedCleanup> {
  const candidates = await dailyExtents(transaction, {});
  const stocks = await transaction.stockBasic.findMany();
  const ranges = stockMarketRanges(stocks);
  const limitScope = await prepareStockLimitScopeCleanup(transaction);
  const outsideLimits = new Set(limitScope.items.map((item) => item.code));
  const exclusions: DailyFilter[] = [];
  const unproven: DailyFilter[] = [];

  for (const code of new Set(candidates.map((row) => row.code!))) {
    const range = ranges.get(canonicalStockCode(code));
    const start = confirmedMarketStart(code, range?.exchange);
    if (start) {
      exclusions.push({ tsCode: code, tradeDate: { lt: start.date } });
    }
    if (!range?.startDate || range.uncertain) {
      unproven.push({ tsCode: code, tradeDate: { gte: start?.date } });
      continue;
    }
    const dates: DailyFilter[] = [];
    if (!start || range.startDate > start.date) {
      dates.push({ tradeDate: { gte: start?.date, lt: range.startDate } });
    }
    if (range.endDate) {
      dates.push({ tradeDate: { gte: start?.date, gt: range.endDate } });
    }
    if (dates.length) {
      unproven.push({ tsCode: code, OR: dates });
    }
  }

  const where: DailyFilter = { OR: exclusions };
  const items = (await dailyExtents(transaction, where)).map((item) => ({
    ...item,
    reason: 'History precedes confirmed admission to the maintained market',
    source: confirmedMarketStart(item.code!, ranges.get(canonicalStockCode(item.code!))?.exchange)!
      .source,
  }));
  const retained = (await dailyExtents(transaction, { OR: unproven }))
    .filter((item) => item.table !== 'StkLimit' || !outsideLimits.has(item.code))
    .map((item) => ({
      ...item,
      reason: 'Historical market or listing status is unverified; retained for review',
    }));
  const from = items.map((item) => item.from!).sort()[0];
  const to = items
    .map((item) => item.to!)
    .sort()
    .at(-1);

  return {
    items: [...items, ...limitScope.items],
    retained,
    coverage: [
      ...(items.length
        ? ['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'].map(
            (dataset) => ({ dataset, scope: 'all', from, to }),
          )
        : []),
      ...limitScope.coverage,
    ],
    apply: async () => {
      let changed = 0;
      for (const batch of dailyBatches(where)) {
        const prices = await transaction.daily.deleteMany({ where: batch });
        const adjustments = await transaction.adjFactor.deleteMany({ where: batch });
        const valuations = await transaction.dailyBasic.deleteMany({ where: batch });
        const limits = await transaction.stkLimit.deleteMany({ where: batch });
        changed += prices.count + adjustments.count + valuations.count + limits.count;
      }
      changed += await limitScope.apply();

      return changed;
    },
  };
}

/**
 * 聚合实际命中记录，预览、待核实清单和删除使用相同筛选字段。
 *
 * Aggregate actual matches using the same filter fields for preview, retained rows and deletion.
 */
async function dailyExtents(
  transaction: MarketTransaction,
  where: DailyFilter,
): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];
  const tables = ['Daily', 'AdjFactor', 'DailyBasic', 'StkLimit'];
  for (const batch of dailyBatches(where)) {
    const grouping = {
      by: ['tsCode'] as ['tsCode'],
      where: batch,
      _min: { tradeDate: true as const },
      _max: { tradeDate: true as const },
      _count: true as const,
    };
    const groups = await Promise.all([
      transaction.daily.groupBy(grouping),
      transaction.adjFactor.groupBy(grouping),
      transaction.dailyBasic.groupBy(grouping),
      transaction.stkLimit.groupBy(grouping),
    ]);
    items.push(
      ...groups.flatMap((rows, index) =>
        rows.map((row) => ({
          table: tables[index],
          code: row.tsCode,
          count: row._count,
          from: row._min.tradeDate!,
          to: row._max.tradeDate!,
          reason: '',
        })),
      ),
    );
  }

  return items;
}

/**
 * 分批生成查询谓词，避免全市场条件超过 SQLite 表达式深度；不截断清理范围。
 *
 * Batch predicates below SQLite expression-depth limits without truncating the cleanup scope.
 */
function* dailyBatches(where: DailyFilter): Generator<DailyFilter> {
  if (!where.OR) {
    yield where;
    return;
  }
  for (let offset = 0; offset < where.OR.length; offset += 100) {
    yield { ...where, OR: where.OR.slice(offset, offset + 100) };
  }
}
