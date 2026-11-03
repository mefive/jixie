import { MarketError } from '../errors.js';
import { sameValues } from '../synchronization/rows.js';
import type { MarketRow } from '../synchronization/partition.js';

/**
 * 对查询截止日已可得的实施记录去重；公告仍逐条保存，不把送转当现金。
 *
 * Deduplicate already-visible cash implementations; retain source announcements and exclude shares.
 */
export function selectImplementedCashDividends<Row extends MarketRow>(rows: Row[]): Row[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const cash = [row.cashDiv, row.cashDivTax];
    const hasCash = cash.some((value) => typeof value === 'number' && value !== 0);
    const hasKnownCash = cash.some((value) => typeof value === 'number');
    if (!hasCash && (hasKnownCash || row.distributionKind === 'shares')) {
      continue;
    }
    const key = JSON.stringify([row.tsCode, row.endDate, row.exDate]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const selected: Row[] = [];
  for (const group of groups.values()) {
    const events = new Map<string, Row>();
    const ordered = [...group].sort((left, right) =>
      JSON.stringify([left.date, left.observedAt, left.annDate, left.id]).localeCompare(
        JSON.stringify([right.date, right.observedAt, right.annDate, right.id]),
      ),
    );
    for (const row of ordered) {
      if (group.length > 1 && (!row.recordDate || !row.payDate)) {
        throw new MarketError('ambiguous_dividend_event', {
          details: { tsCode: row.tsCode, endDate: row.endDate, exDate: row.exDate },
        });
      }
      const key = JSON.stringify([row.recordDate, row.payDate]);
      const before = events.get(key);
      if (before) {
        const content = (value: Row) => ({
          cashDiv: value.cashDiv ?? null,
          cashDivTax: value.cashDivTax ?? null,
          baseShare: value.baseShare ?? null,
          stockDividend: value.stockDividend ?? null,
          stockBonusRate: value.stockBonusRate ?? null,
          stockCapitalizationRate: value.stockCapitalizationRate ?? null,
        });
        if (row.cashDivTax == null || !sameValues(content(before), content(row))) {
          throw new MarketError('ambiguous_dividend_event', {
            details: { tsCode: row.tsCode, endDate: row.endDate, exDate: row.exDate },
          });
        }
        continue;
      }
      events.set(key, row);
    }
    selected.push(...events.values());
  }

  return selected;
}
