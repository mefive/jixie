import type {
  FactorAnalysisKind,
  FactorAnalysisSpec,
  FactorReport,
  FactorResearchIntentV1,
  FactorResearchMetric,
} from './factor.js';
import type { FactorSignalHorizonUnit } from './factor-dependency.js';

export type FactorObservationFrequency = 'daily' | 'weekly' | 'monthly';

/**
 * 冻结前瞻收益窗口及目标定义，供评估一致计算。
 * Freeze forward-return windows and target definitions for evaluation.
 */
export interface FactorForwardReturnTargetV1 {
  kind: 'forward_total_return';
  horizon: number;
  horizonUnit: FactorSignalHorizonUnit;
}

/**
 * 声明因子研究的时点可得规则，供来源对齐。
 * Declare point-in-time rules used to align factor research sources.
 */
export interface FactorPointInTimePolicyV1 {
  pointInTime: true;
  revisionPolicy: 'as_available';
  dataCutoff: string | null;
}

/**
 * 声明宏观版本及披露政策，避免当前修订回填。
 * Declare macro vintage and release policies to prevent revised-data backfill.
 */
export interface MacroPointInTimePolicyV1 {
  pointInTime: true;
  revisionPolicy: 'as_available' | 'latest_vintage';
  dataCutoff: string | null;
}

/**
 * 兼容生产股票截面评估器，冻结其嵌套协议。
 * Compatibility branch for the production equity evaluator. The nested protocol remains immutable
 * so V1–V5 reports retain byte-for-byte research identity while gaining a typed analysis envelope.
 */
export interface CrossSectionalFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'cross_sectional';
  protocol: FactorAnalysisSpec;
}

/**
 * 冻结单资产时间序列研究的目标、窗口与政策。
 * Freeze time-series targets, windows and research policies.
 */
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

/**
 * 冻结跨资产 Panel 范围、标准化和收益协议。
 * Freeze panel universe, normalization and return protocol.
 */
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

/**
 * 冻结宏观状态与目标资产研究的时点、期间及规则。
 * Freeze dates, periods and policies for macro-regime asset research.
 */
export interface MacroRegimeFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'macro_regime';
  start: string;
  end: string;
  observationFrequency: FactorObservationFrequency;
  targetAssets: string[];
  target: FactorForwardReturnTargetV1;
  dataPolicy: MacroPointInTimePolicyV1;
  stateModel: { kind: 'threshold' | 'quantile'; states: number };
}

/**
 * 区分截面、时间序列、Panel 与宏观状态研究，供协议穷尽分派。
 * Discriminate cross-sectional, time-series, panel and regime protocols.
 */
export type FactorResearchSpecV1 =
  | CrossSectionalFactorResearchSpecV1
  | TimeSeriesFactorResearchSpecV1
  | PanelFactorResearchSpecV1
  | MacroRegimeFactorResearchSpecV1;

/**
 * 保存单资产预测统计与覆盖，供时间序列报告。
 * Describe per-asset predictive statistics and coverage for time-series reports.
 */
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

/**
 * 组合资产结果、聚合指标与研究口径。
 * Collect asset results, aggregate metrics and time-series conventions.
 */
export interface FactorTimeSeriesReportV1 {
  assets: string[];
  periods: number;
  observations: number;
  byAsset: FactorTimeSeriesAssetReportV1[];
}

/**
 * 记录 Panel 资产的有效样本与缺口。
 * Describe valid samples and gaps for a panel asset.
 */
export interface FactorPanelAssetCoverageV1 {
  assetId: string;
  assetClass: MultiAssetClass;
  observations: number;
  firstAsOfDate: string | null;
  lastAsOfDate: string | null;
}

/**
 * 汇总 Panel 单资产类别的研究表现。
 * Summarize panel research performance by asset class.
 */
export interface FactorPanelAssetClassReportV1 {
  assetClass: MultiAssetClass;
  observations: number;
  meanForwardReturn: number;
  topSelections: number;
  bottomSelections: number;
}

/**
 * 解释 Panel 组内标准化的可用组与剔除数量。
 * Describe usable groups and exclusions in panel normalization.
 */
export interface FactorPanelNormalizationDiagnosticsV1 {
  withinClassRankIcMean: number | null;
  withinClassComparisons: number;
  betweenClassRankIcMean: number | null;
  betweenClassPeriods: number;
  betweenClassLongShortNetAnnualized: number;
  betweenClassAverageOneWayTurnover: number;
}

/**
 * 保留单期 Panel 排名、分组及组合表现。
 * Retain period panel ranks, groups and portfolio performance.
 */
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

/**
 * 汇总 Panel 分层、收益、成本与覆盖诊断。
 * Collect panel grouping, returns, costs and coverage diagnostics.
 */
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
  /** Added after the initial Panel V1 launch; absent on frozen historical reports. */
  normalizationDiagnostics?: FactorPanelNormalizationDiagnosticsV1;
  periodReports: FactorPanelPeriodReportV1[];
}

export type FactorMacroRegimeStateKeyV1 =
  | 'growth_strong_inflation_high'
  | 'growth_strong_inflation_low'
  | 'growth_weak_inflation_high'
  | 'growth_weak_inflation_low';

/**
 * 保存单资产在某宏观状态下的收益和样本。
 * Describe an asset's returns and samples within a macro state.
 */
export interface FactorMacroRegimeAssetStateReportV1 {
  assetId: string;
  observations: number;
  meanForwardReturn: number | null;
  medianForwardReturn: number | null;
  forwardReturnVolatility: number | null;
  positiveRate: number | null;
  tenthPercentileReturn: number | null;
  ninetiethPercentileReturn: number | null;
  neweyWestMeanTStat: number | null;
  onePeriodLagObservations: number;
  onePeriodLagMeanForwardReturn: number | null;
}

/**
 * 汇总某宏观状态及其资产表现。
 * Summarize a macro state and its asset performance.
 */
export interface FactorMacroRegimeStateReportV1 {
  key: FactorMacroRegimeStateKeyV1;
  periods: number;
  frequency: number;
  episodes: number;
  averageDurationPeriods: number | null;
  maximumDurationPeriods: number;
  byAsset: FactorMacroRegimeAssetStateReportV1[];
}

/**
 * 保留宏观状态评估区间、目标和结果。
 * Describe macro evaluation periods, targets and outcomes.
 */
export interface FactorMacroRegimePeriodReportV1 {
  asOfDate: string;
  featureAvailableDate: string;
  latestVintageDate: string;
  targetDate: string;
  state: FactorMacroRegimeStateKeyV1;
  growthScore: number;
  inflationScore: number;
  eligibleAssets: number;
}

/**
 * 组合宏观状态统计、区间及来源诊断。
 * Collect macro-state statistics, episodes and source diagnostics.
 */
export interface FactorMacroRegimeReportV1 {
  targetAssets: string[];
  periods: number;
  observations: number;
  skippedPeriods: number;
  revisionPolicy: MacroPointInTimePolicyV1['revisionPolicy'];
  pointInTimeEligible: boolean;
  latestValueBackfillRows: number;
  futureVintageRows: number;
  stateTransitions: number;
  states: FactorMacroRegimeStateReportV1[];
  periodReports: FactorMacroRegimePeriodReportV1[];
}

/**
 * 统一按研究种类区分的报告 payload，供读取和渲染。
 * Unify kind-specific research report payloads for loading and rendering.
 */
export type FactorResearchReportPayloadV1 =
  | { version: 1; analysisKind: 'cross_sectional'; report: FactorReport }
  | { version: 1; analysisKind: 'time_series'; report: FactorTimeSeriesReportV1 }
  | { version: 1; analysisKind: 'panel'; report: FactorPanelReportV1 }
  | { version: 1; analysisKind: 'macro_regime'; report: FactorMacroRegimeReportV1 };

/**
 * 汇总时间序列研究的可比较指标，供预注册判断。
 * Collect comparable time-series metrics for preregistered criteria.
 */
export interface FactorTimeSeriesAggregateMetricsV1 {
  medianNeweyWestT: number;
  meanDirectionHitRate: number;
}

/**
 * 从时间序列研究结果提取聚合指标，供门槛比较。
 * Extract aggregate time-series metrics for criterion evaluation.
 */
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

/**
 * 按研究种类读取指定指标，保留不适用或缺失语义。
 * Resolve a metric by research kind while preserving unavailable or inapplicable values.
 */
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

/**
 * 按预注册比较方向与阈值判断指标是否通过，缺失值不能视为通过。
 * Evaluate a metric against its preregistered direction and threshold without passing missing values.
 */
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
