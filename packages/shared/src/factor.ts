/**
 * Factor-analysis wire types (product line 1.5 · factor research). Each analysis is a single-factor, monthly- or
 * weekly-rebalanced cross-sectional study over a date range — decile-sorted forward returns + Rank IC
 * + a long-short (top−bottom) leg. These are the shapes the API returns and the /factors page renders.
 */

export type FactorFreq = 'month' | 'week';

/** Cross-sectional neutralization applied to factor values before IC / bucketing (3.4). 'none' = raw
 * values; 'size' = residual after regressing on log(total market cap); 'size_industry' = additionally
 * orthogonal to Shenwan level-1 industry (removes the "new factor is just a small-cap / sector bet"
 * illusion). A different neutralization is a different report (it's part of the cache key). */
export type Neutral = 'none' | 'size' | 'size_industry';

/** Quantile-return weighting scheme (modeled on JoinQuant's weight_method): equal-weight = signal
 * strength (small-cap bias); market-cap-weight = tradability / capacity. */
export type FactorWeight = 'equal' | 'mktcap';

/** One row of quantile × forward horizon (daily-normalized) — each quantile's average daily forward
 * return at a given horizon, computed for both weighting schemes. */
export interface QuantileHorizon {
  horizonDays: number; // forward horizon (trading days): 1 / 5 / 10 / 20 / 60
  equal: number[]; // length 10 (deciles), daily-normalized average return (equal-weight)
  mktcap: number[]; // market-cap-weight
}

/** How a factor's values are sourced — drives the compute path (and shown as a tag in the UI).
 * 'custom' = user-authored (defineFactor); its compute runs cross-sectionally over a FactorBar. */
export type FactorKind = 'price' | 'fundamental' | 'moneyflow' | 'custom';

/** Cross-sectional single-stock data a factor's `compute` receives — same-day (point-in-time)
 * valuation / size / liquidity (from daily_basic) + same-day moneyflow (from moneyflow, flow
 * semantics: null when the day has no data, never forward-filled). The price history window comes via
 * compute's second argument `ctx.history` (available only when `window` is declared). */
export interface FactorBar {
  code: string;
  pe: number | null; // price-to-earnings
  peTtm: number | null; // price-to-earnings TTM
  pb: number | null; // price-to-book
  ps: number | null; // price-to-sales
  psTtm: number | null; // price-to-sales TTM
  dvRatio: number | null; // dividend yield %
  dvTtm: number | null; // dividend yield TTM %
  totalMv: number | null; // total market cap (10k yuan)
  circMv: number | null; // circulating market cap (10k yuan)
  turnoverRate: number | null; // turnover rate %
  netMain: number | null; // main-force net amount (10k yuan, exact for the day, null if missing)
  netTotal: number | null; // total net amount (10k yuan, exact for the day, null if missing)
}

/** Catalog entry — one row in the factor list (no analysis, just identity). */
export interface FactorMeta {
  key: string; // preset = stable slug (mom / ep / mf_net_main …); custom = the Factor row's ULID
  label: string; // Chinese
  kind: FactorKind;
  builtin?: boolean; // true = preset (a read-only code row in the library, can be copied into a custom factor)
}

/** One decile bucket's forward-return stats (bucket 0 = lowest factor value … 9 = highest). */
export interface BucketStat {
  bucket: number;
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  navEnd: number;
}

/** The long-short leg (top decile − bottom decile), as a hypothetical market-neutral return stream. */
export interface LongShortStat {
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  navEnd: number;
}

/** Rank IC measured against the N-trading-day-forward return — one point on the IC-decay curve. */
export interface IcDecayPoint {
  horizonDays: number; // forward horizon in trading days (1 / 5 / 10 / 20 / 60)
  icMean: number;
  icir: number; // icMean / icStd across periods
}

/** A single-factor analysis report over one (freq, start, end) window. */
export interface FactorReport {
  factor: string; // unique key
  label: string; // human label (Chinese)
  freq: FactorFreq; // rebalance / forward-return frequency
  neutral?: Neutral; // cross-sectional neutralization applied (absent on old cached reports = 'none')
  start: string; // YYYYMMDD (inclusive)
  end: string; // YYYYMMDD (inclusive)
  periods: number; // number of rebalance periods in the sample (months or weeks)
  icMean: number; // Rank IC mean — sign reveals direction (>0 momentum-like, <0 reversal-like)
  icStd: number;
  icir: number; // icMean / icStd (single-period)
  icirAnnual: number; // icir × √(periodsPerYear)
  icPosRate: number; // fraction of periods with IC > 0
  buckets: BucketStat[]; // length 10 (deciles), ascending by factor value — equal-weight
  longShort: LongShortStat; // equal-weight long-short
  topTurnover: number; // average one-way turnover of the top decile (rebalance churn)
  icDecay: IcDecayPoint[]; // Rank IC at several forward horizons — the decay curve (holding period)
  // —— weighting scheme + quantile × forward horizon (optional: old cached reports lack these) ——
  bucketsMktcap?: BucketStat[]; // market-cap-weighted quantile stats (used when the UI toggles "weighting"; buckets is equal-weight)
  longShortMktcap?: LongShortStat; // market-cap-weighted long-short
  quantileHorizons?: QuantileHorizon[]; // quantile × forward-horizon heatmap (daily-normalized, both weightings)
}

/** A cached run's identity (for the "already run" chips) — the report exists, fetch by these params. */
export interface FactorRun {
  freq: FactorFreq;
  neutral: Neutral;
  start: string;
  end: string;
  computedAt: string; // ISO
}
