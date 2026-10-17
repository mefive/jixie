import type { TradeDate } from './types.js';

/**
 * Phase 5 keeps daily market-risk estimation separate from monthly macro research. A macro state
 * must never be inserted into the daily covariance model merely because both are called factors.
 */
export const MARKET_RISK_FACTOR_KEYS_V1 = [
  'cn_equity',
  'cgb_level',
  'cgb_slope',
  'cgb_curvature',
  'credit_spread',
  'usd_cnh',
  'us_real_yield',
  'gold',
  'commodity',
] as const;

export type MarketRiskFactorKeyV1 = (typeof MARKET_RISK_FACTOR_KEYS_V1)[number];

export const MACRO_RISK_AXIS_KEYS_V1 = [
  'growth',
  'inflation',
  'liquidity',
  'credit',
  'external',
] as const;

export type MacroRiskAxisKeyV1 = (typeof MACRO_RISK_AXIS_KEYS_V1)[number];

export type RiskDriverUnitV1 = 'decimal_return' | 'basis_point_change' | 'score_change';

/**
 * 定义市场风险因子身份、单位和数据来源。
 *
 * Define market risk factor identity, units and sources.
 */
export interface MarketRiskFactorDefinitionV1 {
  version: 1;
  kind: 'market_risk_factor';
  key: MarketRiskFactorKeyV1;
  frequency: 'daily';
  unit: Exclude<RiskDriverUnitV1, 'score_change'>;
  sourceSeries: string[];
  pointInTime: true;
}

/**
 * 定义宏观风险轴的方向、含义与来源。
 *
 * Define macro risk axis direction, meaning and sources.
 */
export interface MacroRiskAxisDefinitionV1 {
  version: 1;
  kind: 'macro_risk_axis';
  key: MacroRiskAxisKeyV1;
  frequency: 'monthly';
  unit: 'score_change';
  sourceSeries: string[];
  pointInTime: true;
}

/**
 * 统一市场与宏观驱动定义，供风险报告解释。
 *
 * Unify market and macro driver definitions for risk interpretation.
 */
export type RiskDriverDefinitionV1 = MarketRiskFactorDefinitionV1 | MacroRiskAxisDefinitionV1;

/**
 * 保留单来源序列覆盖与可得性，供风险血缘。
 *
 * Describe source coverage and availability for risk lineage.
 */
export interface RiskDataLineageSeriesV1 {
  seriesKey: string;
  availableThrough: TradeDate;
  revisionPolicy: 'as_available' | 'latest_vintage' | 'not_revised';
}

/**
 * 汇总模型输入序列、日期和缺口，供复核。
 *
 * Collect model input series, dates and gaps for review.
 */
export interface RiskDataLineageV1 {
  dataCutoff: TradeDate;
  pointInTimeEligible: boolean;
  futureVintageRows: number;
  series: RiskDataLineageSeriesV1[];
}

/**
 * 描述组合市场敞口系数及稳健诊断。
 *
 * Describe portfolio market exposure coefficients and diagnostics.
 */
export interface PortfolioMarketRiskExposureV1 {
  factor: MarketRiskFactorKeyV1;
  coefficient: number;
  coefficientUnit: 'return_per_return' | 'return_per_basis_point';
  varianceContribution: number;
  varianceContributionShare: number | null;
}

/**
 * 组合市场敞口、风险贡献与数据血缘。
 *
 * Collect market exposures, risk contributions and lineage.
 */
export interface PortfolioMarketRiskAnalysisV1 {
  version: 1;
  frequency: 'daily';
  methodology: 'rolling_multivariate_regression_ewma_covariance';
  asOfDate: TradeDate;
  lookbackObservations: number;
  minimumObservations: number;
  observations: number;
  covarianceHalfLife: number;
  annualizedPortfolioVolatility: number | null;
  explainedVariance: number | null;
  exposures: PortfolioMarketRiskExposureV1[];
  lineage: RiskDataLineageV1;
}

/**
 * 保存组合宏观敏感度及稳健统计，不将描述关系解释为因果。
 *
 * Describe macro sensitivities and robust statistics without implying causation.
 */
export interface PortfolioMacroSensitivityV1 {
  axis: MacroRiskAxisKeyV1;
  coefficient: number;
  neweyWestTStat: number;
  observations: number;
}

/**
 * 汇总月度宏观敏感度、样本和限制。
 *
 * Collect monthly macro sensitivities, samples and limitations.
 */
export interface PortfolioMacroRiskAnalysisV1 {
  version: 1;
  frequency: 'monthly';
  methodology: 'monthly_multivariate_regression_newey_west';
  asOfDate: TradeDate;
  lookbackObservations: number;
  minimumObservations: number;
  observations: number;
  neweyWestLag: number;
  pointInTimeEligible: boolean;
  sensitivities: PortfolioMacroSensitivityV1[];
  lineage: RiskDataLineageV1;
}

/**
 * 记录 Alpha 收益与风险驱动的对齐相关关系及样本。
 *
 * Describe aligned Alpha-risk relationships and samples.
 */
export interface AlphaRiskOverlapV1 {
  alphaFactorKey: string;
  alphaReturnKind: 'net_long_short' | 'strategy_attributed';
  marketFactor: MarketRiskFactorKeyV1;
  observations: number;
  correlation: number;
  classification: 'low' | 'material' | 'dominant';
}

/**
 * 定义作用于当前敞口的冻结风险冲击。
 *
 * Describe a frozen shock applied to current exposures.
 */
export interface PortfolioRiskScenarioShockV1 {
  factor: MarketRiskFactorKeyV1;
  shock: number;
  unit: Exclude<RiskDriverUnitV1, 'score_change'>;
}

/**
 * 共享情景分析的身份、估计损益和限制。
 *
 * Describe shared scenario identity, estimated impact and limitations.
 */
interface PortfolioRiskScenarioResultBaseV1 {
  key: string;
  asOfDate: TradeDate;
  shocks: PortfolioRiskScenarioShockV1[];
  estimatedReturnImpact: number;
  methodology: 'linear_factor_shock';
}

export type PortfolioRiskScenarioResultV1 = PortfolioRiskScenarioResultBaseV1 &
  (
    | { kind: 'deterministic' }
    | {
        kind: 'historical';
        historicalWindow: { startDate: TradeDate; endDate: TradeDate };
      }
  );

/**
 * 为历史回测提供可选风险结果，各部分仅在输入满足要求后填充。
 *
 * Optional on cached backtests created before Phase 5. Each section is populated only after its
 * own data lineage and coverage gates pass; missing evidence stays missing instead of becoming 0.
 */
export interface PortfolioRiskAnalysisV1 {
  version: 1;
  separationPolicy: 'daily_market_risk_and_monthly_macro_sensitivity';
  market?: PortfolioMarketRiskAnalysisV1;
  macro?: PortfolioMacroRiskAnalysisV1;
  alphaRiskOverlap?: AlphaRiskOverlapV1[];
  scenarios?: PortfolioRiskScenarioResultV1[];
}

export function isMarketRiskFactorKeyV1(value: string): value is MarketRiskFactorKeyV1 {
  return (MARKET_RISK_FACTOR_KEYS_V1 as readonly string[]).includes(value);
}

export function isMacroRiskAxisKeyV1(value: string): value is MacroRiskAxisKeyV1 {
  return (MACRO_RISK_AXIS_KEYS_V1 as readonly string[]).includes(value);
}
