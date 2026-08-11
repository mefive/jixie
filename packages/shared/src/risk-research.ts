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

export interface MarketRiskFactorDefinitionV1 {
  version: 1;
  kind: 'market_risk_factor';
  key: MarketRiskFactorKeyV1;
  frequency: 'daily';
  unit: Exclude<RiskDriverUnitV1, 'score_change'>;
  sourceSeries: string[];
  pointInTime: true;
}

export interface MacroRiskAxisDefinitionV1 {
  version: 1;
  kind: 'macro_risk_axis';
  key: MacroRiskAxisKeyV1;
  frequency: 'monthly';
  unit: 'score_change';
  sourceSeries: string[];
  pointInTime: true;
}

export type RiskDriverDefinitionV1 = MarketRiskFactorDefinitionV1 | MacroRiskAxisDefinitionV1;

export interface RiskDataLineageSeriesV1 {
  seriesKey: string;
  availableThrough: TradeDate;
  revisionPolicy: 'as_available' | 'latest_vintage' | 'not_revised';
}

export interface RiskDataLineageV1 {
  dataCutoff: TradeDate;
  pointInTimeEligible: boolean;
  futureVintageRows: number;
  series: RiskDataLineageSeriesV1[];
}

export interface PortfolioMarketRiskExposureV1 {
  factor: MarketRiskFactorKeyV1;
  coefficient: number;
  coefficientUnit: 'return_per_return' | 'return_per_basis_point';
  varianceContribution: number;
  varianceContributionShare: number | null;
}

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

export interface PortfolioMacroSensitivityV1 {
  axis: MacroRiskAxisKeyV1;
  coefficient: number;
  neweyWestTStat: number;
  observations: number;
}

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

export interface AlphaRiskOverlapV1 {
  alphaFactorKey: string;
  alphaReturnKind: 'net_long_short' | 'strategy_attributed';
  marketFactor: MarketRiskFactorKeyV1;
  observations: number;
  correlation: number;
  classification: 'low' | 'material' | 'dominant';
}

export interface PortfolioRiskScenarioShockV1 {
  factor: MarketRiskFactorKeyV1;
  shock: number;
  unit: Exclude<RiskDriverUnitV1, 'score_change'>;
}

export interface PortfolioRiskScenarioResultV1 {
  key: string;
  kind: 'deterministic' | 'historical';
  asOfDate: TradeDate;
  shocks: PortfolioRiskScenarioShockV1[];
  estimatedReturnImpact: number;
  methodology: 'linear_factor_shock';
}

/** Optional on cached backtests created before Phase 5. Each section is populated only after its
 * own data lineage and coverage gates pass; missing evidence stays missing instead of becoming 0. */
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
