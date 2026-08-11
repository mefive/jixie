import type { TradeDate } from './types.js';
import type { FactorDependency } from './factor-dependency.js';
import type { MultiAssetClass } from './factor-research.js';
import type { PortfolioRiskAnalysisV1 } from './risk-research.js';

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

export type AllocationAssetClass = MultiAssetClass | 'other';

export interface AllocationContributionRow {
  assetId: string;
  assetClass: AllocationAssetClass;
  averageWeight: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  /** Additive arithmetic contribution relative to initial capital. */
  returnContribution: number;
  /** Euler contribution to portfolio variance; rows sum to one when portfolio variance is positive. */
  riskContribution: number | null;
}

export interface AllocationClassContributionRow {
  assetClass: AllocationAssetClass;
  averageWeight: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  returnContribution: number;
  riskContribution: number | null;
}

export interface AllocationWeightPoint {
  assetId: string;
  assetClass: AllocationAssetClass;
  weight: number;
}

export interface AllocationDriftEvent {
  decisionDate: TradeDate;
  executionDate: TradeDate;
  target: AllocationWeightPoint[];
  preTrade: AllocationWeightPoint[];
  postTrade: AllocationWeightPoint[];
  /** Half of the absolute weight differences, including cash. */
  preTradeDistance: number;
  postTradeDistance: number;
  maxPostTradeDeviation: number;
}

export interface AllocationCorrelationPoint {
  date: TradeDate;
  value: number | null;
  observations: number;
}

export interface AllocationCorrelationPairSeries {
  left: AllocationAssetClass;
  right: AllocationAssetClass;
  points: AllocationCorrelationPoint[];
}

export interface AllocationCorrelationWindow {
  window: 60 | 120;
  asOfDate: TradeDate;
  minimumObservations: number;
  assetClasses: AllocationAssetClass[];
  latest: Array<Array<number | null>>;
  latestObservations: number[][];
  series: AllocationCorrelationPairSeries[];
}

export interface AllocationCorrelationAnalysis {
  methodology: 'equal_weight_asset_class_returns';
  sampling: 'month_end';
  minimumCoverage: number;
  windows: AllocationCorrelationWindow[];
}

export type AllocationRateRegimeKey =
  | 'rates_rising_curve_steep'
  | 'rates_rising_curve_flat'
  | 'rates_falling_curve_steep'
  | 'rates_falling_curve_flat';

export interface AllocationRateRegimeClassMetrics {
  assetClass: AllocationAssetClass;
  observations: number;
  meanDailyReturn: number;
  annualizedMeanReturn: number;
  annualizedVolatility: number;
  positiveDayRate: number;
  maximumEpisodeDrawdown: number;
}

export interface AllocationRateRegimeState {
  key: AllocationRateRegimeKey;
  observations: number;
  episodes: number;
  averageDuration: number;
  assetClasses: AllocationRateRegimeClassMetrics[];
}

export interface AllocationRateRegimeAnalysis {
  methodology: 'cgb_10y_direction_and_10y_2y_relative_slope';
  pointInTime: 'available_date';
  directionLookbackObservations: 60;
  curveMedianLookbackObservations: 252;
  curveMedianMinimumObservations: 120;
  classifiedDays: number;
  totalDays: number;
  latest: {
    asOfDate: TradeDate;
    state: AllocationRateRegimeKey;
    tenYearYieldPct: number;
    tenYearChangeBp: number;
    curveSlopeBp: number;
    curveMedianBp: number;
  } | null;
  states: AllocationRateRegimeState[];
}

/** Engine-produced allocation diagnostics. Consumers must not reconstruct accounting from fills. */
export interface AllocationAnalysis {
  version: 1;
  methodology: 'daily_component_pnl';
  riskMethodology: 'component_covariance';
  observations: number;
  reconciliation: {
    portfolioPnl: number;
    attributedNetPnl: number;
    residual: number;
    tolerance: number;
    reconciled: boolean;
  };
  costs: {
    fees: number;
    slippage: number;
    total: number;
  };
  assets: AllocationContributionRow[];
  assetClasses: AllocationClassContributionRow[];
  drift: AllocationDriftEvent[];
  /** Market-return diversification diagnostics; optional on cached V1 results created before this field. */
  correlations?: AllocationCorrelationAnalysis;
  /** Point-in-time rate-environment diagnostics; optional on cached V1 results created before this field. */
  rateRegimes?: AllocationRateRegimeAnalysis;
  /** Phase 5 market-risk, macro-sensitivity, overlap and scenario analysis. */
  risk?: PortfolioRiskAnalysisV1;
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
  /** Immutable published factor definitions actually loaded for this run. */
  factorDependencies?: FactorDependency[];
  /** Multi-asset allocation attribution, produced when the run carries an approved asset-class universe. */
  allocationAnalysis?: AllocationAnalysis;
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
