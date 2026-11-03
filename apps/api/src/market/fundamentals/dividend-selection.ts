import { mergeStockSource } from '../instruments/source-selection.js';
import { isObservationDate } from '../synchronization/date.js';
import { hasValueConflict } from '../synchronization/rows.js';
import type { MarketRow, SourceRecord } from '../synchronization/partition.js';

/**
 * 只在相同分红事件中排除明确较旧的基准；同日或未知日期的歧义留给原冲突处理。
 *
 * Exclude proven older bases within a dividend event; retain equal or unknown-date ambiguities.
 */
export function preferLatestDividendBases(records: readonly SourceRecord[]): SourceRecord[] {
  const latest = new Map<string, string>();
  for (const record of records) {
    const { id, baseDate } = record.values;
    if (!isObservationDate(baseDate)) {
      continue;
    }

    const key = String(id);
    const previous = latest.get(key);
    if (!previous || baseDate > previous) {
      latest.set(key, baseDate);
    }
  }

  return records.filter((record) => {
    const { id, baseDate } = record.values;

    return !isObservationDate(baseDate) || baseDate === latest.get(String(id));
  });
}

/**
 * 仅分红保护已接纳的新基准；已知同来源同基准的真实冲突不能凭抓取先后覆盖。
 *
 * Protect admitted newer dividend bases; same-source, same-base conflicts cannot use fetch order.
 */
export function mergeDividendSource(
  before: MarketRow | undefined,
  record: SourceRecord,
): MarketRow {
  if (before && isObservationDate(before.baseDate)) {
    const incomingDate = record.values.baseDate;
    if (!isObservationDate(incomingDate) || incomingDate < before.baseDate) {
      return before;
    }

    const business = (row: MarketRow) => ({
      cashDiv: row.cashDiv,
      cashDivTax: row.cashDivTax,
      baseShare: row.baseShare,
      stockDividend: row.stockDividend,
      stockBonusRate: row.stockBonusRate,
      stockCapitalizationRate: row.stockCapitalizationRate,
    });

    if (
      incomingDate === before.baseDate &&
      before.sourceTsCode === record.values.sourceTsCode &&
      hasValueConflict(business(before), business(record.values))
    ) {
      throw new Error(`Conflicting dividend values at the same base date ${incomingDate}`);
    }
  }

  return mergeStockSource(before, record);
}
