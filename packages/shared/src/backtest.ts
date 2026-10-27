import type { TradeDate } from './types.js';
import type { FactorDependency } from './factor-dependency.js';
import type { MultiAssetClass } from './factor-research.js';
import type { PortfolioRiskAnalysisV1 } from './risk-research.js';

/**
 * 配置回测显式费用与隐式冲击，费率、金额和基点字段保持各自单位。
 *
 * Backtest config + result — the wire types for product line 1 (strategy backtest). The strategy itself is now
 * user-authored TypeScript (`code`), compiled and run on the engine; there is no IR.
 */

export interface CostConfig {
  commission?: number; // per-side rate (2.5 bps = 0.00025)
  minCommission?: number; // floor per trade in yuan
  stampDuty?: number; // sell-side only (5 bps = 0.0005)
  transferFee?: number; // both sides
  slippageBps?: number; // base adverse half-spread, both sides, in basis points
  impactCoef?: number;
}

/** Shared defaults for a newly created Strategy Lab draft; generation never asks the LLM to pick them. */
export const DEFAULT_BACKTEST_START: TradeDate = '20200101';
export const DEFAULT_BACKTEST_END: TradeDate = '20241231';
export const DEFAULT_BACKTEST_INITIAL_CASH = 1_000_000;
export const DEFAULT_BACKTEST_COST: Readonly<CostConfig> = {
  slippageBps: 2,
  impactCoef: 0.1,
};

export type StrategyLanguage = 'typescript' | 'python';
export type StrategyRuntimeVersion = 'ts-v1' | 'py-v1';

/**
 * 描述完整可运行回测的日期、资本、成本及作者源码。
 *
 * A full, runnable backtest spec: range + capital + cost + user-authored strategy code.
 */
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

/**
 * 记录一次成交的复权及实际价格数量；真实成交金额在两种口径下一致。
 *
 * One executed fill (the trade-log unit shown on the chart + list). `shares`/`price` are the engine's
 * internal backward-adjusted (hfq) units; `realShares`/`realPrice` are the real, tradable numbers shown to
 * the user — whole lots (100-share lots) at the unadjusted price. `amount` (real money) is the same either way.
 */
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
  assetType?: 'stock' | 'etf';
}

export type AllocationAssetClass = MultiAssetClass | 'other';

/**
 * 返回单资产收益、成本与风险贡献，供配置报告。
 *
 * Describe one asset's return, cost and risk contributions for allocation reports.
 */
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

/**
 * 按资产类别聚合收益与风险贡献，供配置比较。
 *
 * Aggregate return and risk contributions by asset class.
 */
export interface AllocationClassContributionRow {
  assetClass: AllocationAssetClass;
  averageWeight: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  returnContribution: number;
  riskContribution: number | null;
}

/**
 * 记录单日目标或实际资产权重，供配置路径。
 *
 * Describe dated allocation weights for exposure history.
 */
export interface AllocationWeightPoint {
  assetId: string;
  assetClass: AllocationAssetClass;
  weight: number;
}

/**
 * 记录目标与实际配置偏离及调仓信息，供解释执行差异。
 *
 * Describe allocation drift and rebalances for execution analysis.
 */
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

/**
 * 记录单对资产在指定日期的相关性。
 *
 * Describe a dated pairwise asset correlation.
 */
export interface AllocationCorrelationPoint {
  date: TradeDate;
  value: number | null;
  observations: number;
}

/**
 * 保存一对资产的相关性历史，供滚动比较。
 *
 * Retain pairwise correlation history for rolling comparisons.
 */
export interface AllocationCorrelationPairSeries {
  left: AllocationAssetClass;
  right: AllocationAssetClass;
  points: AllocationCorrelationPoint[];
}

/**
 * 封装同一窗口的矩阵与覆盖，供相关性图表。
 *
 * Describe a correlation window's matrix and coverage.
 */
export interface AllocationCorrelationWindow {
  window: 60 | 120;
  asOfDate: TradeDate;
  minimumObservations: number;
  assetClasses: AllocationAssetClass[];
  latest: Array<Array<number | null>>;
  latestObservations: number[][];
  series: AllocationCorrelationPairSeries[];
}

/**
 * 组合各窗口相关性和滚动序列，供分散化诊断。
 *
 * Collect correlation windows and rolling series for diversification diagnostics.
 */
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

/**
 * 汇总某利率环境中单资产类别的绩效。
 *
 * Summarize an asset class's performance within a rate environment.
 */
export interface AllocationRateRegimeClassMetrics {
  assetClass: AllocationAssetClass;
  observations: number;
  meanDailyReturn: number;
  annualizedMeanReturn: number;
  annualizedVolatility: number;
  positiveDayRate: number;
  maximumEpisodeDrawdown: number;
}

/**
 * 保留利率环境分类、曲线证据与区间。
 *
 * Describe rate classifications, curve evidence and episodes.
 */
export interface AllocationRateRegimeState {
  key: AllocationRateRegimeKey;
  observations: number;
  episodes: number;
  averageDuration: number;
  assetClasses: AllocationRateRegimeClassMetrics[];
}

/**
 * 组合利率环境下的配置收益与风险诊断。
 *
 * Collect allocation performance and risk diagnostics by rate regime.
 */
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

/**
 * 返回引擎生成的配置诊断，消费方不应从成交重新构造账户。
 *
 * Engine-produced allocation diagnostics. Consumers must not reconstruct accounting from fills.
 */
export interface AllocationAnalysis {
  version: 1;
  /** Missing on historical reports that used whole-portfolio equity. */
  scope?: 'cash_account';
  /** Equity of the analyzed cash account; required on newly generated scoped reports. */
  nav?: { date: string; value: number }[];
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

/**
 * 定义回测结果的 HTTP 传输形状，与引擎结果保持映射一致。
 *
 * Backtest result shape returned over the wire (mirrors the engine's BacktestResult).
 */
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
    stockGrossExposure: number;
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

/**
 * 提供最近回测的紧凑元数据。
 *
 * Compact metadata for the latest Strategy backtest.
 */
export interface BacktestReportSummary {
  id: string;
  strategyId: string;
  strategyName: string;
  status: 'done';
  start: TradeDate;
  end: TradeDate;
  language: StrategyLanguage;
  totalReturn: number;
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  trades: number;
  createdAt: string;
  computedAt: string | null;
}

/**
 * 运行参数不包含可执行源码。
 *
 * Run settings exclude executable source.
 */
export type BacktestSettings = Omit<BacktestConfig, 'code'>;

export interface BacktestReportDetail extends BacktestReportSummary {
  settings: BacktestSettings;
  result: BacktestSummary;
  needsRerun: boolean;
}

/**
 * 约束策略参数可序列化值，供配置和扫描共享。
 *
 * Constrain serializable strategy parameter values used by configuration and scans.
 */
export type StrategyParamValue = number | string;

/**
 * 定义一个扫描参数及其候选值，供笛卡尔积构造。
 *
 * Describe a scan parameter and candidate values for combination generation.
 */
export interface StrategyParameterDimension {
  key: string;
  values: StrategyParamValue[];
}

/**
 * 冻结参数、仓位或容量扫描规格，供复现计算。
 *
 * Freeze parameter, sizing or capacity scan specifications for reproducibility.
 */
export interface StrategyScanSpec {
  dimensions: StrategyParameterDimension[];
  splitDate?: TradeDate;
  view?: 'parameters' | 'sizing' | 'capacity';
}

/**
 * 汇总单次回测核心指标，供扫描单元比较。
 *
 * Collect headline backtest metrics for scan-cell comparison.
 */
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

/**
 * 关联一组参数与其运行指标或错误，供扫描结果。
 *
 * Associate one parameter combination with metrics or failure.
 */
export interface StrategyScanCell {
  params: Record<string, StrategyParamValue>;
  full?: BacktestMetricSummary;
  inSample?: BacktestMetricSummary;
  outOfSample?: BacktestMetricSummary;
  /** Rebased NAV (starts at 1) is retained only for the dedicated sizing comparison view. */
  nav?: { date: string; value: number }[];
}

/**
 * 保存完整扫描维度、结果和配置快照。
 *
 * Retain scan dimensions, results and configuration snapshots.
 */
export interface StrategyScanPayload {
  parameters: Record<string, StrategyParamValue>;
  cells: StrategyScanCell[];
}

export type StrategyScanStatus = 'running' | 'done' | 'error' | 'stale';

/**
 * 关联扫描身份、状态与保留结果，供详情读取。
 *
 * Describe scan identity, state and retained results.
 */
export interface StrategyScanReport {
  id: string;
  strategyId: string;
  strategyName: string;
  status: StrategyScanStatus;
  settings: BacktestSettings;
  spec: StrategyScanSpec;
  needsRerun: boolean;
  dataCutoff: TradeDate | null;
  payload?: StrategyScanPayload;
  error?: string;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 提供扫描报告紧凑摘要，供最近结果查询。
 *
 * Describe compact scan report metadata for latest-result queries.
 */
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
