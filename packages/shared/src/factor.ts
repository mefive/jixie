/**
 * Factor-analysis wire types (产品线 1.5 · 因子研究). The engine pre-computes factor values into the
 * FactorValue table; the analysis runs a monthly cross-sectional study per factor — decile-sorted
 * forward returns + Rank IC + a long-short (top−bottom) leg — and returns one FactorReport per factor.
 * These are the shapes the API returns and the /factors page renders.
 */

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

/** A full single-factor analysis report (monthly rebalance, whole-market, liquidity-filtered). */
export interface FactorReport {
  factor: string; // unique key (mom / rev / ep / size / mf_net_main …)
  label: string; // human label (中文)
  months: number; // number of rebalance months in the sample
  icMean: number; // Rank IC mean — sign reveals direction (>0 momentum-like, <0 reversal-like)
  icStd: number;
  icir: number; // icMean / icStd (single-period)
  icirAnnual: number; // icir × √12
  icPosRate: number; // fraction of months with IC > 0
  buckets: BucketStat[]; // length 10 (deciles), ascending by factor value
  longShort: LongShortStat;
  topTurnover: number; // average one-way turnover of the top decile (rebalance churn)
}
