import type { BacktestConfig } from './backtest.js';
import type { Locale } from './i18n.js';
import type { TradeDate } from './types.js';

export type SignalAssetType = 'stock' | 'etf';
export type SignalAction = 'buy' | 'sell';
export type SignalSource = 'target' | 'order';

/** One next-open order instruction derived from a deployed strategy's final pending intent. */
export interface SignalItem {
  code: string;
  name: string;
  assetType: SignalAssetType;
  action: SignalAction;
  shares: number;
  refPrice: number;
  refAmount: number;
  source: SignalSource;
  targetWeight?: number;
}

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
  signals?: SignalItem[];
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
