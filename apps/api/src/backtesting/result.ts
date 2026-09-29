import type { AllocationAnalysis } from '@jixie/shared';
import type { Position } from './cash-portfolio.js';
import type { CostModel } from './cost.js';
import type { TradeRecord } from './trade.js';
import type { CashOrderSnapshot } from './order-book.js';

export interface BacktestingResult {
  name: string;
  start: string;
  end: string;
  days: number;
  initialCash: number;
  finalValue: number;
  totalReturn: number;
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  trades: number; // count (= tradeLog.length)
  tradeLog: TradeRecord[]; // every fill, in order
  nav: { date: string; value: number }[]; // daily equity curve
  sleeveNav?: SleeveNavPoint[];
  benchReturn: number; // CSI 300 total return over the same period
  excessReturn: number; // totalReturn − benchReturn
  informationRatio: number; // annualized information ratio
  calmar: number; // annReturn / |maxDrawdown|
  winRate: number; // share of profitable closed trades
  profitFactor: number; // Σ profit / Σ loss
  turnover: number; // annualized turnover
  totalFees: number;
  totalSlippage: number;
  cost: CostModel;
  monthly: { month: string; ret: number }[]; // 'YYYYMM' → monthly return
  allocationAnalysis?: AllocationAnalysis;
}

export interface FactorObservation {
  key: string;
  code: string;
  value: number | null;
}

/** Detached stock/ETF state at the final close. Shares and triggers retain Engine adjusted units. */
export interface BacktestingFinalState extends CashOrderSnapshot {
  tradeDate: string;
  equity: number;
  cash: number;
  positions: Map<string, Position>;
  market: Map<
    string,
    {
      assetType: 'stock' | 'etf';
      adjustedClose: number | null;
      adjustmentFactor: number | null;
      rawClose: number | null;
    }
  >;
  factorObservations: FactorObservation[];
}

export interface BacktestingOutput {
  result: BacktestingResult;
  finalState: BacktestingFinalState | null;
}

export interface SleeveNavPoint {
  date: string;
  stockValue: number;
  futureValue: number;
  futureMargin: number;
  stockGrossExposure: number;
  futureNotional: number;
  netExposure: number;
}
