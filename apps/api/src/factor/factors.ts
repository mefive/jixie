/**
 * Price-based factors. Inputs: a stock's ascending array of backward-adjusted (hfq) closes px +
 * the corresponding trading dates (YYYYMMDD) + the rebalance-day index end.
 * Only reads px[0..end] (point-in-time, never looks ahead); returns null if there's insufficient
 * history or a long suspension gap within the window.
 * Does not pre-negate to fix a direction — computes on raw values; the direction is revealed by
 * the sign of the backtest IC.
 */

import type { FactorMeta } from '@jixie/shared';
import { daysBetween } from '../lib/date.js';

// If the calendar gap between adjacent trading days within the window exceeds this many days
// (≈ 1+ month suspension), the series is treated as discontinuous and the factor untrustworthy.
// The Spring Festival break is about 9 days, far below this, so it won't be falsely flagged.
const MAX_GAP_DAYS = 30;

/** Max calendar gap (days) between adjacent trading days within the range [from, to]. */
function maxGapDays(dates: string[], from: number, to: number): number {
  let m = 0;
  for (let i = from + 1; i <= to; i++) {
    const g = daysBetween(dates[i - 1], dates[i]);
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

/** Price-factor registry (window functions over the price series). */
export const FACTORS: FactorDef[] = [
  { key: 'mom', label: '动量(60日,跳5)', fn: (px, dates, end) => momentum(px, dates, end) },
  { key: 'rev', label: '反转(5日)', fn: (px, dates, end) => reversal(px, dates, end) },
  { key: 'vol', label: '波动率(20日)', fn: (px, dates, end) => volatility(px, dates, end) },
];

/** The daily_basic fields that fundamental factors read from. */
export interface FundamentalRow {
  peTtm: number | null;
  pb: number | null;
  dvRatio: number | null;
  totalMv: number | null;
}

export interface FundamentalFactorDef {
  key: string;
  label: string;
  from: (r: FundamentalRow) => number | null;
}

/**
 * Fundamental-factor registry (derived from daily_basic, point-in-time per trade date).
 * Stored as raw values; the IC sign reveals direction (e.g. ep/bp/dv expected positive,
 * size expected negative = small-cap premium).
 */
export const FUNDAMENTAL_FACTORS: FundamentalFactorDef[] = [
  { key: 'ep', label: '盈利收益率(1/PE_TTM)', from: (r) => (r.peTtm && r.peTtm > 0 ? 1 / r.peTtm : null) },
  { key: 'bp', label: '账面市值比(1/PB)', from: (r) => (r.pb && r.pb > 0 ? 1 / r.pb : null) },
  { key: 'dv', label: '股息率(%)', from: (r) => r.dvRatio },
  {
    key: 'size',
    label: '规模(ln总市值)',
    from: (r) => (r.totalMv && r.totalMv > 0 ? Math.log(r.totalMv) : null),
  },
];

/** Labels for factors sourced outside the two registries above (read from their own raw tables, e.g.
 * moneyflow from the Moneyflow table) — so the analysis report shows a 中文 name, not the raw key. */
const EXTRA_FACTOR_LABELS: Record<string, string> = {
  mf_net_main: '主力净额(万元)',
  mf_net_total: '总净额(万元)',
};

/** key → label for every factor (price + fundamental + opt-in), used by the analysis report. */
export const FACTOR_LABELS: Record<string, string> = {
  ...Object.fromEntries([...FACTORS, ...FUNDAMENTAL_FACTORS].map((f) => [f.key, f.label])),
  ...EXTRA_FACTOR_LABELS,
};

/** The full factor catalog (identity + kind) — drives the /factors list and the single-factor analyze
 * dispatch (kind decides the compute path: price=per-stock series, fundamental=daily_basic, moneyflow=table). */
export const FACTOR_CATALOG: FactorMeta[] = [
  ...FACTORS.map((f) => ({ key: f.key, label: f.label, kind: 'price' as const })),
  ...FUNDAMENTAL_FACTORS.map((f) => ({ key: f.key, label: f.label, kind: 'fundamental' as const })),
  { key: 'mf_net_main', label: EXTRA_FACTOR_LABELS.mf_net_main, kind: 'moneyflow' },
  { key: 'mf_net_total', label: EXTRA_FACTOR_LABELS.mf_net_total, kind: 'moneyflow' },
];
