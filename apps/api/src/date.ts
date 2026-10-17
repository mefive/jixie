import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';

// Our dates are 'YYYYMMDD' strings (Tushare format), which dayjs can't parse by default —
// customParseFormat enables dayjs(str, 'YYYYMMDD'). isoWeek adds Mon–Sun week bucketing.
dayjs.extend(customParseFormat);
dayjs.extend(isoWeek);

const FMT = 'YYYYMMDD';

/**
 * 将 YYYYMMDD 日期解析为 dayjs，供统一日期运算。
 *
 * Parse a 'YYYYMMDD' string into a dayjs object.
 */
export function day(ymd: string) {
  return dayjs(ymd, FMT);
}

/**
 * 判断两个紧凑日期是否属于同一自然月。
 *
 * Whether two 'YYYYMMDD' dates fall in the same calendar month.
 */
export function sameMonth(a: string, b: string): boolean {
  return day(a).isSame(day(b), 'month');
}

/**
 * 判断两个日期是否属于同一 ISO 周，即周一到周日。
 *
 * Whether two 'YYYYMMDD' dates fall in the same ISO week (Mon–Sun).
 */
export function sameWeek(a: string, b: string): boolean {
  return day(a).startOf('isoWeek').isSame(day(b).startOf('isoWeek'), 'day');
}

/**
 * 返回指定日期所在 ISO 周的周一 YYYYMMDD 键。
 *
 * Monday date (YYYYMMDD) of the ISO week containing `ymd`.
 */
export function isoWeekKey(ymd: string): string {
  return day(ymd).startOf('isoWeek').format(FMT);
}

/**
 * 按自然日移动日期，负数向过去移动。
 *
 * The 'YYYYMMDD' that is `n` calendar days after `ymd` (negative values move backwards).
 */
export function addDays(ymd: string, n: number): string {
  return day(ymd).add(n, 'day').format(FMT);
}

/**
 * 返回指定自然日数之前的 YYYYMMDD 日期。
 *
 * The 'YYYYMMDD' that is `n` calendar days before `ymd`.
 */
export function minusDays(ymd: string, n: number): string {
  return addDays(ymd, -n);
}

// Days since the Unix epoch for a 'YYYYMMDD' string, via plain integer math (no dayjs).
function epochDay(ymd: string): number {
  return Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 86_400_000;
}

/**
 * 计算 b−a 的完整自然日差，供因子等高频日期判断。
 *
 * Whole calendar days from `a` to `b` (b - a), both 'YYYYMMDD'.
 * Hot path — called per factor evaluation (millions of times under on-the-fly computation), so it
 * uses integer date math instead of dayjs parsing (which is far too slow at that volume). dayjs is
 * kept for the readable, low-frequency helpers above.
 */
export function daysBetween(a: string, b: string): number {
  return epochDay(b) - epochDay(a);
}
