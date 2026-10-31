import { calendarDay } from './date.js';

export interface ListingInterval {
  startDate: string;
  endDate?: string;
  exchange?: string | null;
  uncertain?: boolean;
}

/**
 * 仅返回上市区间发生变化的日期；名称等元数据不参与覆盖失效。
 *
 * Return changed listing dates only; descriptive metadata never invalidates coverage.
 */
export function changedListingIntervals(
  before: ListingInterval | undefined,
  after: ListingInterval | undefined,
): Array<{ startDate: string; endDate?: string }> {
  if (!before || !after) {
    return before || after ? [before ?? after!] : [];
  }
  const exchangeChanged = before.exchange && after.exchange && before.exchange !== after.exchange;
  const uncertaintyChanged = Boolean(before.uncertain) !== Boolean(after.uncertain);
  if (exchangeChanged || uncertaintyChanged) {
    let endDate: string | undefined;
    if (before.endDate && after.endDate) {
      endDate = before.endDate > after.endDate ? before.endDate : after.endDate;
    }

    return [
      {
        startDate: before.startDate < after.startDate ? before.startDate : after.startDate,
        endDate,
      },
    ];
  }

  const boundaries = [
    ...new Set([
      before.startDate,
      after.startDate,
      ...(before.endDate ? [calendarDay(before.endDate, 1)] : []),
      ...(after.endDate ? [calendarDay(after.endDate, 1)] : []),
    ]),
  ].sort();
  const changes: Array<{ startDate: string; endDate?: string }> = [];
  for (let index = 0; index < boundaries.length; index++) {
    const startDate = boundaries[index];
    const wasInside =
      startDate >= before.startDate && (!before.endDate || startDate <= before.endDate);
    const isInside = startDate >= after.startDate && (!after.endDate || startDate <= after.endDate);
    if (wasInside !== isInside) {
      const next = boundaries[index + 1];
      changes.push({ startDate, endDate: next ? calendarDay(next, -1) : undefined });
    }
  }

  return changes;
}
