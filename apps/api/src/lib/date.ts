import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isoWeek from 'dayjs/plugin/isoWeek';

// Our dates are 'YYYYMMDD' strings (Tushare format), which dayjs can't parse by default —
// customParseFormat enables dayjs(str, 'YYYYMMDD'). isoWeek adds Mon–Sun week bucketing.
dayjs.extend(customParseFormat);
dayjs.extend(isoWeek);

const FMT = 'YYYYMMDD';

/** Parse a 'YYYYMMDD' string into a dayjs object. */
export function day(ymd: string) {
  return dayjs(ymd, FMT);
}

/** Whether two 'YYYYMMDD' dates fall in the same calendar month. */
export function sameMonth(a: string, b: string): boolean {
  return day(a).isSame(day(b), 'month');
}

/** Whether two 'YYYYMMDD' dates fall in the same ISO week (Mon–Sun). */
export function sameWeek(a: string, b: string): boolean {
  return day(a).startOf('isoWeek').isSame(day(b).startOf('isoWeek'), 'day');
}

/** The 'YYYYMMDD' that is `n` calendar days before `ymd`. */
export function minusDays(ymd: string, n: number): string {
  return day(ymd).subtract(n, 'day').format(FMT);
}

// Days since the Unix epoch for a 'YYYYMMDD' string, via plain integer math (no dayjs).
function epochDay(ymd: string): number {
  return Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 86_400_000;
}

/**
 * Whole calendar days from `a` to `b` (b - a), both 'YYYYMMDD'.
 * Hot path — called per factor evaluation (millions of times under on-the-fly computation), so it
 * uses integer date math instead of dayjs parsing (which is far too slow at that volume). dayjs is
 * kept for the readable, low-frequency helpers above.
 */
export function daysBetween(a: string, b: string): number {
  return epochDay(b) - epochDay(a);
}
