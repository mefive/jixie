import type { z } from 'zod';
import type { actualExecutionSchema } from './api/signals.js';
import type { BacktestConfig } from './backtest.js';
import type { FactorDependency, FactorInputSummary } from './factor-dependency.js';
import type { Locale } from './i18n.js';
import type { StrategyAccounts } from './sdk/strategy/contract.js';
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

/**
 * 表示冻结策略末日待执行意图生成的一条可执行信号。
 *
 * One executable instruction derived from a deployed strategy's final pending intent. Market orders
 * target the next open; conditional orders remain active until their trigger or cancellation.
 */
export interface SignalItem {
  code: string;
  name: string;
  assetType: SignalAssetType;
  action: SignalAction;
  shares: number;
  refPrice: number;
  refAmount: number;
  source: SignalSource;
  conditionId?: string;
  orderType?: SignalOrderType;
  triggerPrice?: number;
  trailingPct?: number;
  targetWeight?: number;
}

/**
 * 以真实股数冻结信号收盘模型持仓，供影子账户前推。
 *
 * Real-share model position frozen at the signal close to seed forward shadow accounting.
 */
export interface ModelPositionSnapshot {
  code: string;
  name: string;
  assetType: SignalAssetType;
  shares: number;
  markPrice: number;
  sellableFrom: TradeDate;
  /** Real shares still under T+1 freeze; absent legacy snapshots conservatively mean all shares. */
  frozenShares?: number;
}

export type SimulatedExecutionStatus = 'pending' | 'filled' | 'blocked';
export type ActualExecutionStatus = 'pending' | 'filled' | 'skipped';

/**
 * 保存单信号指令可查询的执行状态。
 *
 * Queryable execution state for one signal instruction.
 */
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

/**
 * 记录模型或人工影子账户的日终状态，供对账比较。
 *
 * End-of-day point from either the deterministic simulation or the manual execution shadow account.
 */
export interface StrategyAccountPoint {
  date: TradeDate;
  cash: number;
  marketValue: number;
  equity: number;
  isBaseline: boolean;
}

/**
 * 汇总部署信号、任务和账户差异，供执行概览。
 *
 * Collect deployment signals, tasks and account differences for reconciliation.
 */
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

export type ActualExecutionUpdate = z.input<typeof actualExecutionSchema>;

export type StrategyDeploymentStatus = 'active' | 'paused';

/**
 * 冻结每日信号调度器使用的可运行策略版本。
 *
 * Immutable runnable strategy version used by the daily signal scheduler.
 */
export interface StrategyDeployment {
  accountingVersion?: number;
  id: string;
  /** Null only for legacy deployments whose source report is unknown. */
  backtestReportId: string | null;
  strategyId: string;
  strategyName: string;
  status: StrategyDeploymentStatus;
  config: BacktestConfig;
  factorDependencies: FactorDependency[];
  codeHash: string;
  locale: Locale;
  deployedAt: string;
  stoppedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SignalRunStatus = 'running' | 'done' | 'error' | 'stale';

/**
 * 保存某部署在一个市场收盘时点的持久信号结果。
 *
 * One deployment's durable signal result for a market close.
 */
export interface SignalRun {
  resultVersion?: number;
  modelAccounts?: SignalAccounts | null;
  futureSignals?: FutureSignalItem[];
  id: string;
  deploymentId: string;
  strategyId: string;
  strategyName: string;
  tradeDate: TradeDate;
  execDate: TradeDate;
  status: SignalRunStatus;
  factorDependencies: FactorDependency[];
  factorInputs: FactorInputSummary[];
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

/**
 * 组合活跃或暂停部署与最近运行，供今日页面。
 *
 * Active or paused deployment plus its most recent run, used by the Today page.
 */
export interface SignalTodayEntry {
  deployment: StrategyDeployment;
  run: SignalRun | null;
}

/**
 * 返回策略关联的部署与最近信号元数据。
 *
 * Describe strategy deployment and latest-signal metadata.
 */
export interface StrategySignalMetadata {
  watch: string[];
  /** @deprecated Retained for historical metadata; ignored. */
  futures: string[];
  accounts?: StrategyAccounts;
  factors: string[];
}

export type FutureAccountSnapshot = z.infer<typeof import('./api/signals.js').futureAccountSchema>;
export type FutureSignalItem = z.infer<typeof import('./api/signals.js').futureSignalSchema>;
export type SignalExecutionLeg = z.infer<typeof import('./api/signals.js').executionLegSchema>;
export type SignalFutureIntent = z.infer<typeof import('./api/signals.js').futureIntentSchema>;
export type SignalAccounts = z.infer<typeof import('./api/signals.js').signalAccountsSchema>;

/**
 * 组合版本化账户、任务和成交历史，供重放审阅。
 *
 * Collect versioned accounts, tasks and fills for replay review.
 */
export interface SignalAccountHistory {
  simulationStatus: string;
  actualStatus: string;
  revision: number;
  status: string;
  error: string | null;
  modelBaseline: boolean;
  simulation: SignalAccounts[];
  actual: SignalAccounts[];
  tasks: SignalTask[];
}

/**
 * 汇总信号执行数量与差异，保持资产和合约可比范围。
 *
 * Summarize execution counts and differences within comparable assets and contracts.
 */
export interface SignalExecutionSummary {
  status: 'pending' | 'partial' | 'filled' | 'recorded' | 'skipped' | 'no_action';
  fills: number;
  averagePriceDeviationBps: number | null;
}

/**
 * 冻结现金或期货指令及处理状态，供人工成交和账户重放。
 *
 * Describe frozen cash or futures tasks for manual fills and account replay.
 */
export interface SignalTask {
  maintenanceConflict?: boolean;
  sourceRunId?: string | null;
  summary?: SignalExecutionSummary;
  actualStatus: string;
  actualReason: string | null;
  id: string;
  execDate: string;
  intent: SignalItem | FutureSignalItem;
  resolutions: Array<{ id: string; kind: string; accountRevision: number; payload: unknown }>;
  fills: Array<{
    id: string;
    tradeDate: string;
    replacesId: string | null;
    voided: boolean;
    payload: unknown;
  }>;
}
