/**
 * Factor-analysis wire types (产品线 1.5 · 因子研究). Each analysis is a single-factor, monthly- or
 * weekly-rebalanced cross-sectional study over a date range — decile-sorted forward returns + Rank IC
 * + a long-short (top−bottom) leg. These are the shapes the API returns and the /factors page renders.
 */

export type FactorFreq = 'month' | 'week';

/** How a factor's values are sourced — drives the compute path (and shown as a tag in the UI). */
export type FactorKind = 'price' | 'fundamental' | 'moneyflow';

/** Catalog entry — one row in the factor list (no analysis, just identity). */
export interface FactorMeta {
  key: string; // mom / rev / vol / ep / bp / dv / size / mf_net_main / mf_net_total
  label: string; // 中文
  kind: FactorKind;
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
  label: string; // human label (中文)
  freq: FactorFreq; // rebalance / forward-return frequency
  start: string; // YYYYMMDD (inclusive)
  end: string; // YYYYMMDD (inclusive)
  periods: number; // number of rebalance periods in the sample (months or weeks)
  icMean: number; // Rank IC mean — sign reveals direction (>0 momentum-like, <0 reversal-like)
  icStd: number;
  icir: number; // icMean / icStd (single-period)
  icirAnnual: number; // icir × √(periodsPerYear)
  icPosRate: number; // fraction of periods with IC > 0
  buckets: BucketStat[]; // length 10 (deciles), ascending by factor value
  longShort: LongShortStat;
  topTurnover: number; // average one-way turnover of the top decile (rebalance churn)
  icDecay: IcDecayPoint[]; // Rank IC at several forward horizons — the decay curve (holding period)
}

/** A cached run's identity (for the "已跑" chips) — the report exists, fetch by these params. */
export interface FactorRun {
  freq: FactorFreq;
  start: string;
  end: string;
  computedAt: string; // ISO
}
