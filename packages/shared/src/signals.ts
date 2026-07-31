import type { BacktestConfig } from './backtest.js';
import type { Locale } from './i18n.js';
import type { TradeDate } from './types.js';

export type SignalAssetType = 'stock' | 'etf';
export type SignalAction = 'buy' | 'sell';
export type SignalSource = 'target' | 'order' | 'conditional';
export type SignalOrderType =
  | 'market_open'
  | 'stop_loss'
  | 'trailing_stop'
  | 'limit_buy'
  | 'take_profit';

/** One executable instruction derived from a deployed strategy's final pending intent. Market orders
 * target the next open; conditional orders remain active until their trigger or cancellation. */
export interface SignalItem {
  code: string;
  name: string;
  assetType: SignalAssetType;
  action: SignalAction;
  shares: number;
  refPrice: number;
  refAmount: number;
  source: SignalSource;
  orderType?: SignalOrderType;
  triggerPrice?: number;
  trailingPct?: number;
  targetWeight?: number;
}

/** Real-share model position frozen at the signal close to seed forward shadow accounting. */
export interface ModelPositionSnapshot {
  code: string;
  name: string;
  assetType: SignalAssetType;
  shares: number;
  markPrice: number;
  sellableFrom: TradeDate;
}

export type SimulatedExecutionStatus = 'pending' | 'filled' | 'blocked';
export type ActualExecutionStatus = 'pending' | 'filled' | 'skipped';

/** Queryable execution state for one signal instruction. */
export interface SignalExecution {
  id: string;
  signalRunId: string;
  signalIndex: number;
  signal: SignalItem;
  simulatedStatus: SimulatedExecutionStatus;
  simulatedShares?: number | null;
  simulatedPrice?: number | null;
  simulatedFee?: number | null;
  simulatedSlippage?: number | null;
  simulatedReason?: string | null;
  actualStatus: ActualExecutionStatus;
  actualShares?: number | null;
  actualPrice?: number | null;
  actualFee?: number | null;
  actualReason?: string | null;
  actualNote?: string | null;
  actualRecordedAt?: string | null;
}

/** End-of-day point from either the deterministic simulation or the manual execution shadow account. */
export interface StrategyAccountPoint {
  date: TradeDate;
  cash: number;
  marketValue: number;
  equity: number;
  isBaseline: boolean;
}

export interface StrategyExecutionOverview {
  model: Array<{ date: TradeDate; equity: number }>;
  simulation: StrategyAccountPoint[];
  actual: StrategyAccountPoint[];
  execution: {
    total: number;
    filled: number;
    skipped: number;
    pending: number;
    executionRate: number | null;
    averagePriceDeviationBps: number | null;
  };
}

export type ActualExecutionUpdate =
  | { status: 'pending' }
  | {
      status: 'filled';
      shares: number;
      price: number;
      fee?: number;
      reason?: string;
      note?: string;
    }
  | { status: 'skipped'; reason: string; note?: string };

export type StrategyDeploymentStatus = 'active' | 'paused';

/** Immutable runnable strategy version used by the daily signal scheduler. */
export interface StrategyDeployment {
  id: string;
  strategyId: string;
  strategyName: string;
  status: StrategyDeploymentStatus;
  config: BacktestConfig;
  codeHash: string;
  locale: Locale;
  deployedAt: string;
  stoppedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SignalRunStatus = 'running' | 'done' | 'error' | 'stale';

/** One deployment's durable signal result for a market close. */
export interface SignalRun {
  id: string;
  deploymentId: string;
  strategyId: string;
  strategyName: string;
  tradeDate: TradeDate;
  execDate: TradeDate;
  status: SignalRunStatus;
  dataCutoff?: TradeDate | null;
  modelEquity?: number | null;
  modelCash?: number | null;
  modelPositions?: ModelPositionSnapshot[];
  signals?: SignalItem[];
  executions?: SignalExecution[];
  error?: string | null;
  notifiedAt?: string | null;
  notificationError?: string | null;
  jobId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Active deployment plus its most recent run, used by the Today page. */
export interface SignalTodayEntry {
  deployment: StrategyDeployment;
  run: SignalRun | null;
}

export interface StrategySignalMetadata {
  watch: string[];
  futures: string[];
  factors: string[];
}
