import type { TradeDate } from './types.js';
import type { FactorReleaseDependency } from './factor-release.js';

/**
 * Backtest config + result — the wire types for product line 1 (strategy backtest). The strategy itself is now
 * user-authored TypeScript (`code`), compiled and run on the engine; there is no IR.
 */

export interface CostConfig {
  commission?: number; // per-side rate (2.5 bps = 0.00025)
  minCommission?: number; // floor per trade in yuan
  stampDuty?: number; // sell-side only (5 bps = 0.0005)
  transferFee?: number; // both sides
  slippageBps?: number; // base adverse half-spread, both sides, in basis points
  impactCoef?: number; // linear impact per order-notional / daily-turnover ratio
  futureCommissionRate?: number;
  futureCloseTodayRate?: number;
  futureSlippageTicks?: number;
  futureMarginRate?: number;
}

export type StrategyLanguage = 'typescript' | 'python';
export type StrategyRuntimeVersion = 'ts-v1' | 'py-v1';

/** A full, runnable backtest spec: range + capital + cost + user-authored strategy code. */
export interface BacktestConfig {
  name: string;
  start: TradeDate;
  end: TradeDate;
  initialCash: number;
  cost?: CostConfig;
  /** Missing on legacy rows and interpreted as TypeScript. */
  language?: StrategyLanguage;
  /** Frozen authoring/runtime contract. Missing on legacy rows and interpreted as ts-v1. */
  runtimeVersion?: StrategyRuntimeVersion;
  code: string;
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
  slippageCost?: number; // adverse fill-price loss versus the unslipped open, in yuan
  realShares: number; // real shares filled (buys are whole lots)
  realPrice: number; // unadjusted (raw) fill price — what you'd actually have paid
  assetType?: 'stock' | 'etf' | 'future';
  actualCode?: string;
  contracts?: number;
  multiplier?: number;
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
  sleeveNav?: {
    date: string;
    stockValue: number;
    futureValue: number;
    futureMargin: number;
    stockGrossExposure: number;
    futureNotional: number;
    netExposure: number;
  }[];
  // benchmark comparison + more performance metrics — optional: results cached before this was added won't carry them.
  benchReturn?: number; // CSI 300 total return over the same period
  excessReturn?: number; // totalReturn − benchReturn
  informationRatio?: number; // annualized information ratio = mean(excess daily return) / std × √252
  calmar?: number; // annReturn / |maxDrawdown|
  winRate?: number; // fraction of profitable closes (round-trip pairing)
  profitFactor?: number; // Σ profits / Σ losses
  turnover?: number; // annualized turnover = one-way turnover / average equity / year
  totalFees?: number; // explicit commission, stamp duty and transfer fees
  totalSlippage?: number; // implicit adverse fill-price loss
  cost?: Required<CostConfig>; // applied cost snapshot; absent on results saved before cost transparency
  monthly?: { month: string; ret: number }[]; // 'YYYYMM' → monthly return (monthly-return table)
  /** Immutable factor definitions actually loaded for this run. Missing on legacy results. */
  factorReleases?: FactorReleaseDependency[];
}

export type StrategyParamValue = number | string;

export interface StrategyParameterDimension {
  key: string;
  values: StrategyParamValue[];
}

export interface StrategyScanSpec {
  dimensions: StrategyParameterDimension[];
  splitDate?: TradeDate;
  view?: 'parameters' | 'sizing' | 'capacity';
}

export interface BacktestMetricSummary {
  start: TradeDate;
  end: TradeDate;
  days: number;
  finalValue: number;
  totalReturn: number;
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  trades: number;
  benchReturn: number;
  excessReturn: number;
  informationRatio: number;
  calmar: number;
  winRate: number;
  profitFactor: number;
  turnover: number;
  totalFees: number;
  totalSlippage: number;
  annVolatility?: number;
  maxUnderwaterDays?: number;
  /** Annualized slippage loss divided by initial capital. */
  annSlippageDrag?: number;
}

export interface StrategyScanCell {
  params: Record<string, StrategyParamValue>;
  full?: BacktestMetricSummary;
  inSample?: BacktestMetricSummary;
  outOfSample?: BacktestMetricSummary;
  /** Rebased NAV (starts at 1) is retained only for the dedicated sizing comparison view. */
  nav?: { date: string; value: number }[];
}

export interface StrategyScanPayload {
  parameters: Record<string, StrategyParamValue>;
  cells: StrategyScanCell[];
}

export type StrategyScanStatus = 'running' | 'done' | 'error' | 'stale';

export interface StrategyScanReport {
  id: string;
  strategyId: string;
  strategyName: string;
  status: StrategyScanStatus;
  config: BacktestConfig;
  spec: StrategyScanSpec;
  codeHash: string;
  dataCutoff: TradeDate | null;
  payload?: StrategyScanPayload;
  error?: string;
  jobId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyScanReportSummary {
  id: string;
  strategyId: string;
  strategyName: string;
  status: StrategyScanStatus;
  spec: StrategyScanSpec;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
