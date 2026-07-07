import type { TradeDate } from './types.js';

/**
 * Backtest config + result — the wire types for product line 1 (strategy backtest). The strategy itself is now
 * user-authored TypeScript (`code`), compiled and run on the engine; there is no IR.
 */

export interface CostConfig {
  commission?: number; // per-side rate (2.5 bps = 0.00025)
  minCommission?: number; // floor per trade in yuan
  stampDuty?: number; // sell-side only (5 bps = 0.0005)
  transferFee?: number; // both sides
}

/** A full, runnable backtest spec: range + capital + cost + the user-authored TS strategy code. */
export interface BacktestConfig {
  name: string;
  start: TradeDate;
  end: TradeDate;
  initialCash: number;
  cost?: CostConfig;
  code: string; // TypeScript strategy module: export default defineStrategy({ … })
}

/** One executed fill (the trade-log unit shown on the chart + list). `shares`/`price` are the engine's
 * internal backward-adjusted (hfq) units; `realShares`/`realPrice` are the real, tradable numbers shown to
 * the user — whole lots (100-share lots) at the unadjusted price. `amount` (real money) is the same either way. */
export interface TradeRecord {
  date: TradeDate;
  code: string;
  side: 'buy' | 'sell';
  shares: number; // hfq shares (engine-internal)
  price: number; // hfq fill price (engine-internal)
  amount: number; // realShares × realPrice = shares × price (turnover, real money)
  fee: number;
  realShares: number; // real shares filled (buys are whole lots)
  realPrice: number; // unadjusted (raw) fill price — what you'd actually have paid
}

/** Backtest result shape returned over the wire (mirrors the engine's BacktestResult). */
export interface BacktestSummary {
  name: string;
  start: TradeDate;
  end: TradeDate;
  days: number;
  initialCash: number;
  finalValue: number;
  totalReturn: number;
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  trades: number; // count
  tradeLog: TradeRecord[]; // every fill, in order (time/code/side/amount/quantity)
  nav: { date: string; value: number }[]; // daily equity curve
  // benchmark comparison + more performance metrics — optional: results cached before this was added won't carry them.
  benchReturn?: number; // CSI 300 total return over the same period
  excessReturn?: number; // totalReturn − benchReturn
  informationRatio?: number; // annualized information ratio = mean(excess daily return) / std × √252
  calmar?: number; // annReturn / |maxDrawdown|
  winRate?: number; // fraction of profitable closes (round-trip pairing)
  profitFactor?: number; // Σ profits / Σ losses
  turnover?: number; // annualized turnover = one-way turnover / average equity / year
  monthly?: { month: string; ret: number }[]; // 'YYYYMM' → monthly return (monthly-return table)
}
