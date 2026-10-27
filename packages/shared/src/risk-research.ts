import type { TradeDate } from './types.js';

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
export type RiskDriverDefinitionV1 = MacroRiskAxisDefinitionV1;

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
 * 为历史回测提供可选风险结果，各部分仅在输入满足要求后填充。
 *
 * Optional on cached backtests created before Phase 5. Each section is populated only after its
 * own data lineage and coverage gates pass; missing evidence stays missing instead of becoming 0.
 */
export interface PortfolioRiskAnalysisV1 {
  version: 1;
  separationPolicy: 'daily_market_risk_and_monthly_macro_sensitivity';
  macro?: PortfolioMacroRiskAnalysisV1;
}

export function isMacroRiskAxisKeyV1(value: string): value is MacroRiskAxisKeyV1 {
  return (MACRO_RISK_AXIS_KEYS_V1 as readonly string[]).includes(value);
}
