import type { AllocationAnalysis, FutureAccountSnapshot } from '@jixie/shared';
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
export interface CashFinalStateView extends CashOrderSnapshot {
  futureAccount?: FutureAccountSnapshot;
  futureOrders?: Array<{ code: string; intent: import('./order-book.js').FutureIntent }>;
  futureMarket?: import('./data/data-port.js').FutureMarketRows;
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

export interface BacktestingFinalState extends Omit<
  CashFinalStateView,
  | 'positions'
  | 'market'
  | 'pendingTargets'
  | 'pendingOrders'
  | 'pendingLotOrders'
  | 'conditionalOrders'
> {
  schemaVersion: 2;
  positions: Array<[string, Position]>;
  market: Array<
    [string, CashFinalStateView['market'] extends Map<string, infer Value> ? Value : never]
  >;
  pendingTargets: Array<[string, number]> | null;
  pendingOrders: Array<[string, number]> | null;
  pendingLotOrders: Array<[string, number]> | null;
  conditionalOrders: Array<[string, import('./order-book.js').ConditionalOrder]>;
}

export function serializeFinalState(state: CashFinalStateView): BacktestingFinalState {
  return structuredClone({
    ...state,
    schemaVersion: 2,
    positions: [...state.positions],
    market: [...state.market],
    pendingTargets: state.pendingTargets ? [...state.pendingTargets] : null,
    pendingOrders: state.pendingOrders ? [...state.pendingOrders] : null,
    pendingLotOrders: state.pendingLotOrders ? [...state.pendingLotOrders] : null,
    conditionalOrders: [...state.conditionalOrders],
  });
}

export function cashFinalStateView(state: BacktestingFinalState): CashFinalStateView {
  return {
    ...state,
    positions: new Map(state.positions),
    market: new Map(state.market),
    pendingTargets: state.pendingTargets ? new Map(state.pendingTargets) : null,
    pendingOrders: state.pendingOrders ? new Map(state.pendingOrders) : null,
    pendingLotOrders: state.pendingLotOrders ? new Map(state.pendingLotOrders) : null,
    conditionalOrders: new Map(state.conditionalOrders),
  };
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
