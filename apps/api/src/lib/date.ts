import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

// Our dates are 'YYYYMMDD' strings (Tushare format), which dayjs can't parse by default —
// customParseFormat enables dayjs(str, 'YYYYMMDD').
dayjs.extend(customParseFormat);

const FMT = 'YYYYMMDD';

/** Parse a 'YYYYMMDD' string into a dayjs object. */
export function day(ymd: string) {
  return dayjs(ymd, FMT);
}

/** Whether two 'YYYYMMDD' dates fall in the same calendar month. */
export function sameMonth(a: string, b: string): boolean {
  return day(a).isSame(day(b), 'month');
}

/** The 'YYYYMMDD' that is `n` calendar days before `ymd`. */
export function minusDays(ymd: string, n: number): string {
  return day(ymd).subtract(n, 'day').format(FMT);
}

/** Whole calendar days from `a` to `b` (b - a), both 'YYYYMMDD'. */
export function daysBetween(a: string, b: string): number {
  return day(b).diff(day(a), 'day');
}
