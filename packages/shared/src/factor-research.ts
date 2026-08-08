import type {
  FactorAnalysisKind,
  FactorAnalysisSpec,
  FactorReport,
  FactorResearchIntentV1,
  FactorResearchMetric,
} from './factor.js';
import type { FactorSignalHorizonUnit } from './factor-dependency.js';

export type FactorObservationFrequency = 'daily' | 'weekly' | 'monthly';

export interface FactorForwardReturnTargetV1 {
  kind: 'forward_total_return';
  horizon: number;
  horizonUnit: FactorSignalHorizonUnit;
}

export interface FactorPointInTimePolicyV1 {
  pointInTime: true;
  revisionPolicy: 'as_available';
  dataCutoff: string | null;
}

/** Compatibility branch for the production equity evaluator. The nested protocol remains immutable
 * so V1–V5 reports retain byte-for-byte research identity while gaining a typed analysis envelope. */
export interface CrossSectionalFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'cross_sectional';
  protocol: FactorAnalysisSpec;
}

export interface TimeSeriesFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'time_series';
  start: string;
  end: string;
  observationFrequency: FactorObservationFrequency;
  assets: string[];
  target: FactorForwardReturnTargetV1;
  dataPolicy: FactorPointInTimePolicyV1;
  inference: {
    standardError: 'newey_west';
    lag: 'automatic' | number;
  };
}

export interface PanelFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'panel';
  start: string;
  end: string;
  observationFrequency: FactorObservationFrequency;
  assets: Array<{
    assetId: string;
    assetClass: MultiAssetClass;
  }>;
  target: FactorForwardReturnTargetV1;
  dataPolicy: FactorPointInTimePolicyV1;
  rankingScope: 'cross_asset';
  volatilityScaling: 'none' | 'inverse_volatility';
  minimumAssetsPerPeriod: number;
  portfolio: {
    topFraction: number;
    bottomFraction: number;
    transactionCostPerSide: number;
  };
}

export type MultiAssetClass =
  | 'cn_equity'
  | 'overseas_equity'
  | 'fixed_income'
  | 'gold'
  | 'commodity';

export interface MacroRegimeFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'macro_regime';
  start: string;
  end: string;
  observationFrequency: FactorObservationFrequency;
  targetAssets: string[];
  target: FactorForwardReturnTargetV1;
  dataPolicy: FactorPointInTimePolicyV1;
  stateModel: { kind: 'threshold' | 'quantile'; states: number };
}

export type FactorResearchSpecV1 =
  | CrossSectionalFactorResearchSpecV1
  | TimeSeriesFactorResearchSpecV1
  | PanelFactorResearchSpecV1
  | MacroRegimeFactorResearchSpecV1;

export interface FactorTimeSeriesAssetReportV1 {
  assetId: string;
  observations: number;
  correlation: number;
  regressionSlope: number;
  directionHitRate: number;
  neweyWestLag: number;
  neweyWestTStat: number;
  positiveStateMeanReturn: number | null;
  negativeStateMeanReturn: number | null;
}

export interface FactorTimeSeriesReportV1 {
  assets: string[];
  periods: number;
  observations: number;
  byAsset: FactorTimeSeriesAssetReportV1[];
}

export interface FactorPanelAssetCoverageV1 {
  assetId: string;
  assetClass: MultiAssetClass;
  observations: number;
  firstAsOfDate: string | null;
  lastAsOfDate: string | null;
}

export interface FactorPanelAssetClassReportV1 {
  assetClass: MultiAssetClass;
  observations: number;
  meanForwardReturn: number;
  topSelections: number;
  bottomSelections: number;
}

export interface FactorPanelPeriodReportV1 {
  asOfDate: string;
  targetDate: string;
  eligibleAssets: number;
  rankIc: number;
  equalWeightReturn: number;
  topReturn: number;
  bottomReturn: number;
  longShortGrossReturn: number;
  longShortNetReturn: number;
  oneWayTurnover: number;
}

export interface FactorPanelReportV1 {
  assets: Array<{ assetId: string; assetClass: MultiAssetClass }>;
  periods: number;
  observations: number;
  skippedPeriods: number;
  coverage: {
    minimumAssets: number;
    medianAssets: number;
    maximumAssets: number;
    byAsset: FactorPanelAssetCoverageV1[];
  };
  rankIcMean: number;
  rankIcirAnnual: number;
  rankIcPositiveRate: number;
  equalWeightAnnualized: number;
  topAnnualized: number;
  bottomAnnualized: number;
  longShortGrossAnnualized: number;
  longShortNetAnnualized: number;
  averageOneWayTurnover: number;
  byAssetClass: FactorPanelAssetClassReportV1[];
  periodReports: FactorPanelPeriodReportV1[];
}

export interface FactorMacroRegimeReportV1 {
  targetAssets: string[];
  periods: number;
  states: Array<{ key: string; observations: number; meanForwardReturn: number }>;
}

export type FactorResearchReportPayloadV1 =
  | { version: 1; analysisKind: 'cross_sectional'; report: FactorReport }
  | { version: 1; analysisKind: 'time_series'; report: FactorTimeSeriesReportV1 }
  | { version: 1; analysisKind: 'panel'; report: FactorPanelReportV1 }
  | { version: 1; analysisKind: 'macro_regime'; report: FactorMacroRegimeReportV1 };

export interface FactorTimeSeriesAggregateMetricsV1 {
  medianNeweyWestT: number;
  meanDirectionHitRate: number;
}

export function timeSeriesAggregateMetrics(
  report: FactorTimeSeriesReportV1,
): FactorTimeSeriesAggregateMetricsV1 {
  const orderedTStats = report.byAsset
    .map((asset) => asset.neweyWestTStat)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const middle = Math.floor(orderedTStats.length / 2);
  const medianNeweyWestT =
    orderedTStats.length === 0
      ? Number.NaN
      : orderedTStats.length % 2 === 0
        ? (orderedTStats[middle - 1] + orderedTStats[middle]) / 2
        : orderedTStats[middle];
  const hitRates = report.byAsset.map((asset) => asset.directionHitRate).filter(Number.isFinite);
  return {
    medianNeweyWestT,
    meanDirectionHitRate:
      hitRates.length === 0
        ? Number.NaN
        : hitRates.reduce((sum, value) => sum + value, 0) / hitRates.length,
  };
}

export function factorResearchMetricValue(
  payload: FactorResearchReportPayloadV1,
  metric: FactorResearchMetric,
): number {
  if (payload.analysisKind === 'cross_sectional') {
    const values = {
      rank_ic_mean: payload.report.icMean,
      rank_icir_annual: payload.report.icirAnnual,
      net_long_short_annualized: payload.report.longShortNet?.annReturn ?? Number.NaN,
    } as Partial<Record<FactorResearchMetric, number>>;
    return values[metric] ?? Number.NaN;
  }
  if (payload.analysisKind === 'time_series') {
    const aggregate = timeSeriesAggregateMetrics(payload.report);
    const values = {
      time_series_median_newey_west_t: aggregate.medianNeweyWestT,
      time_series_mean_direction_hit_rate: aggregate.meanDirectionHitRate,
    } as Partial<Record<FactorResearchMetric, number>>;
    return values[metric] ?? Number.NaN;
  }
  if (payload.analysisKind === 'panel') {
    const values = {
      panel_rank_ic_mean: payload.report.rankIcMean,
      panel_net_long_short_annualized: payload.report.longShortNetAnnualized,
    } as Partial<Record<FactorResearchMetric, number>>;
    return values[metric] ?? Number.NaN;
  }
  return Number.NaN;
}

export function factorResearchCriterionPassed(
  payload: FactorResearchReportPayloadV1,
  intent?: FactorResearchIntentV1,
): boolean {
  const criterion = intent?.primaryCriterion;
  if (!criterion) {
    return false;
  }
  const value = factorResearchMetricValue(payload, criterion.metric);
  if (!Number.isFinite(value)) {
    return false;
  }
  return criterion.operator === 'gt' ? value > criterion.value : value < criterion.value;
}

export function researchAnalysisKind(spec: FactorResearchSpecV1): FactorAnalysisKind {
  return spec.analysisKind;
}
