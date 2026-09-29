export interface FutureBar {
  code: string; // logical code requested by the strategy
  actualCode: string; // actual delivery contract as-of the bar date
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  settle: number | null;
  volume: number | null;
  amount: number | null;
  openInterest: number | null;
  multiplier: number;
}

/** One stock's adjusted (hfq) OHLC on one day — the unit a per-instrument strategy reads via bars().
 * vol/amount are raw (not adjusted): the day's volume (lots) and turnover (thousand yuan). */
export interface OhlcBar {
  date: string;
  adjOpen: number;
  adjHigh: number;
  adjLow: number;
  adjClose: number;
  vol: number | null;
  amount: number | null;
  turnoverRateF: number | null; // free-float turnover rate %, from daily_basic when requested
}

/** Higher-timeframe buckets derived from daily bars. */
export type ResamplePeriod = 'weekly' | 'monthly';

/**
 * One stock's full market row on a given day: backward-adjusted (hfq) OHLC for return math, the raw
 * unadjusted OHLC for reference, and the raw daily_basic valuation (point-in-time). This is the unit
 * a cross-sectional strategy ranks on. A field is null when the source didn't report it that day.
 */
export interface BarRow {
  code: string;
  name: string | null; // point-in-time security name
  riskWarning: boolean; // ST / *ST / other exchange risk-warning prefix as-of this date
  pendingDelisting: boolean; // delisting-period name as-of this date
  open: number | null; // unadjusted
  high: number | null;
  low: number | null;
  close: number | null;
  adjOpen: number | null; // backward-adjusted (hfq)
  adjHigh: number | null;
  adjLow: number | null;
  adjClose: number | null;
  vol: number | null; // volume (lots)
  amount: number | null; // turnover (thousand yuan) — the liquidity / slippage gate
  pe: number | null;
  peTtm: number | null;
  pb: number | null;
  ps: number | null;
  psTtm: number | null;
  dvRatio: number | null; // dividend yield %
  dvTtm: number | null;
  totalMv: number | null; // total market cap (10k yuan)
  circMv: number | null; // circulating market cap (10k yuan)
  turnoverRate: number | null; // turnover %
  roe: number | null; // return on equity %, point-in-time (latest report public as-of today)
  roeWaa: number | null; // weighted average return on equity %
  roa: number | null; // return on assets %, point-in-time
  grossprofitMargin: number | null; // gross profit margin %, point-in-time
  debtToAssets: number | null; // debt-to-assets ratio %, point-in-time
}

export type IndexValuationField = 'pe' | 'peTtm' | 'pb';

export interface IndexHandle {
  readonly close: number | null; // today's index level (as-of ≤ today); null if not synced
  readonly pe: number | null; // provider-computed static PE, as-of today
  readonly peTtm: number | null; // provider-computed trailing-twelve-month PE, as-of today
  readonly pb: number | null; // provider-computed PB, as-of today
  sma(n: number): number | null; // n-day moving average (index close series); null if insufficient data
  /** Percentile rank in [0, 1] among observations available up to today. `lookback` is the maximum
   * number of daily observations (e.g. 2520 ≈ ten trading years); omitted means all history. */
  percentile(field: IndexValuationField, lookback?: number): number | null;
}
