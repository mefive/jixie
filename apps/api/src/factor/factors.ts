/**
 * Price-based factors. Inputs: a stock's ascending array of backward-adjusted (hfq) closes px +
 * the corresponding trading dates (YYYYMMDD) + the rebalance-day index end.
 * Only reads px[0..end] (point-in-time, never looks ahead); returns null if there's insufficient
 * history or a long suspension gap within the window.
 * Does not pre-negate to fix a direction — computes on raw values; the direction is revealed by
 * the sign of the backtest IC.
 */

// If the calendar gap between adjacent trading days within the window exceeds this many days
// (≈ 1+ month suspension), the series is treated as discontinuous and the factor untrustworthy.
// The Spring Festival break is about 9 days, far below this, so it won't be falsely flagged.
const MAX_GAP_DAYS = 30;

function parseYmd(d: string): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
}

/** Max calendar gap (days) between adjacent trading days within the range [from, to]. */
function maxGapDays(dates: string[], from: number, to: number): number {
  let m = 0;
  for (let i = from + 1; i <= to; i++) {
    const g = (parseYmd(dates[i]) - parseYmd(dates[i - 1])) / 86_400_000;
    if (g > m) m = g;
  }
  return m;
}

/** Momentum: return from D-lookback to D-skip (skip the most recent `skip` days to avoid
 * short-term reversal contamination). */
export function momentum(
  px: number[],
  dates: string[],
  end: number,
  lookback = 60,
  skip = 5,
): number | null {
  if (end - lookback < 0) return null;
  if (maxGapDays(dates, end - lookback, end) > MAX_GAP_DAYS) return null;
  const a = px[end - skip];
  const b = px[end - lookback];
  if (!a || !b) return null;
  return a / b - 1;
}

/** Short-term reversal: return over the last `window` days (A-shares are retail-heavy, so this
 * factor's IC is usually negative = buy the biggest losers). */
export function reversal(px: number[], dates: string[], end: number, window = 5): number | null {
  if (end - window < 0) return null;
  if (maxGapDays(dates, end - window, end) > MAX_GAP_DAYS) return null;
  const a = px[end];
  const b = px[end - window];
  if (!b) return null;
  return a / b - 1;
}

/** Realized volatility: standard deviation of daily returns over the last `window` days
 * (low-volatility anomaly, IC is usually negative = lower vol does better). */
export function volatility(px: number[], dates: string[], end: number, window = 20): number | null {
  if (end - window < 0) return null;
  if (maxGapDays(dates, end - window, end) > MAX_GAP_DAYS) return null;
  const rets: number[] = [];
  for (let i = end - window + 1; i <= end; i++) {
    const prev = px[i - 1];
    if (!prev) return null;
    rets.push(px[i] / prev - 1);
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

export interface FactorDef {
  key: string;
  label: string;
  fn: (px: number[], dates: string[], end: number) => number | null;
}

/** Factor registry: both compute and the backtest iterate over it — adding a new factor only
 * touches this. */
export const FACTORS: FactorDef[] = [
  { key: 'mom', label: '动量(60日,跳5)', fn: (px, dates, end) => momentum(px, dates, end) },
  { key: 'rev', label: '反转(5日)', fn: (px, dates, end) => reversal(px, dates, end) },
  { key: 'vol', label: '波动率(20日)', fn: (px, dates, end) => volatility(px, dates, end) },
];
