import type { TradeDate } from './types.js';

/**
 * Backtest config + result — the wire types for 产品线 1 (策略回测). The strategy itself is now
 * user-authored TypeScript (`code`), compiled and run on the engine; there is no IR.
 */

export interface CostConfig {
  commission?: number; // per-side rate (万2.5 = 0.00025)
  minCommission?: number; // floor per trade in yuan
  stampDuty?: number; // sell-side only (千0.5 = 0.0005)
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

/** One executed fill (the trade-log unit shown on the chart + list). */
export interface TradeRecord {
  date: TradeDate;
  code: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  amount: number; // shares × price (成交额)
  fee: number;
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
}
