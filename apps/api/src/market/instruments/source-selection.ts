import { hasStockCodePredecessor, stockSourceRank } from './stock-identity.js';
import type { MarketRow, SourceRecord } from '../synchronization/partition.js';
import { mergeSourceRecord } from '../synchronization/rows.js';

/**
 * 每个业务身份先选择原始代码；保留同来源重复行，交由领域判断冲突。
 *
 * Select the original code per business identity; domains still validate same-source duplicates.
 */
export function preferStockSources<Row>(
  rows: readonly Row[],
  identity: (row: Row) => string,
  source: (row: Row) => string | null | undefined,
): Row[] {
  const ranks = new Map<string, number>();
  for (const row of rows) {
    const key = identity(row);
    const rank = stockSourceRank(source(row));
    ranks.set(key, Math.max(ranks.get(key) ?? Number.NEGATIVE_INFINITY, rank));
  }

  return rows.filter((row) => stockSourceRank(source(row)) === ranks.get(identity(row)));
}

/**
 * 快照不被旧来源降级；切换来源时使用完整新记录，不拼接不同口径的字段。
 *
 * Never downgrade snapshots to an older source; source switches replace the whole record.
 */
export function mergeStockSource(before: MarketRow | undefined, record: SourceRecord): MarketRow {
  const incoming = record.values;
  const source = typeof incoming.sourceTsCode === 'string' ? incoming.sourceTsCode : null;
  const previous = typeof before?.sourceTsCode === 'string' ? before.sourceTsCode : null;
  if (before && stockSourceRank(source) < stockSourceRank(previous)) {
    return before;
  }
  const hasAliases = source && hasStockCodePredecessor(source);
  if (before && source !== previous && (previous !== null || hasAliases)) {
    const cleared = Object.fromEntries(Object.keys(before).map((field) => [field, null]));

    return { ...cleared, ...incoming };
  }

  return mergeSourceRecord(before, record);
}
