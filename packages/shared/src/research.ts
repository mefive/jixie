import type { TradeDate } from './types.js';
import type { ChartKind, ChartSeriesSpec } from './chart.js';

export type ResearchAssetTypeV1 = 'stock' | 'etf' | 'index' | 'future';
export type ResearchFrequencyV1 = 'daily' | 'monthly';
export type ResearchQuestionKindV1 =
  | 'time_series_relationship'
  | 'multivariate_time_series_relationship'
  | 'distribution_comparison'
  | 'event_study';
export type ResearchTransformV1 =
  | 'level'
  | 'difference'
  | 'simple_return'
  | 'percent_change'
  | 'year_over_year';

export interface ResearchEntityRefV1 {
  assetType: ResearchAssetTypeV1;
  id: string;
}

export type ResearchEntitySetSourceV1 =
  | { kind: 'equity_market'; market: 'CN' }
  | { kind: 'index_members'; indexCode: string }
  | { kind: 'explicit'; entities: ResearchEntityRefV1[] };

export type ResearchAsOfSpecV1 =
  | { kind: 'fixed'; date: TradeDate }
  | { kind: 'latest_available' }
  | { kind: 'periodic'; frequency: 'month_end' };

export interface ResearchMeasurePredicateV1 {
  measure: string;
  measureVersion: 1;
  op: '>' | '>=' | '<' | '<=' | '==' | '!=';
  value: number | string;
}

export interface ResearchUniverseMeasureRefV1 {
  measure: string;
  measureVersion: 1;
}

export interface ResearchUniverseEligibilityV1 {
  minimumListedDays: number;
  suspension: 'exclude';
  riskWarning: 'include' | 'exclude';
}

/** A point-in-time entity selector. Resolution freezes the resulting members on every ResearchRun. */
export interface UniverseSpecV1 {
  version: 1;
  source: ResearchEntitySetSourceV1;
  asOf: ResearchAsOfSpecV1;
  eligibility: ResearchUniverseEligibilityV1;
  predicates: ResearchMeasurePredicateV1[];
  missing: 'exclude';
  sort?: ResearchUniverseMeasureRefV1 & { direction: 'asc' | 'desc' };
  select: ResearchUniverseMeasureRefV1[];
  limit?: number;
}

export interface ResearchUniverseMeasureDefinitionV1 {
  id: string;
  version: 1;
  nameZh: string;
  nameEn: string;
  unit: string;
  descriptionZh: string;
  descriptionEn: string;
  pointInTime: true;
}

export interface ResearchUniverseRowV1 {
  entity: ResearchEntityRefV1;
  name: string;
  industry: string | null;
  values: Record<string, number | null>;
}

export interface ResearchUniverseStageV1 {
  code: 'source' | 'listed' | 'not_suspended' | 'risk_warning' | 'predicates';
  count: number;
}

export interface ResearchUniverseRunResultV1 {
  version: 1;
  spec: UniverseSpecV1;
  requestedAsOfDate: TradeDate | null;
  asOfDate: TradeDate;
  membershipAsOfDate: TradeDate | null;
  dataRevision: number;
  total: number;
  rows: ResearchUniverseRowV1[];
  measures: ResearchUniverseMeasureDefinitionV1[];
  stages: ResearchUniverseStageV1[];
  diagnostics: ResearchDiagnosticV1[];
}

export type ResearchSeriesSourceV1 =
  | { kind: 'instrument'; assetType: ResearchAssetTypeV1; id: string }
  | { kind: 'macro'; seriesKey: string }
  | { kind: 'yield_curve'; curveCode: string; curveType: string; termYears: number }
  | { kind: 'fx'; id: string };

export interface ResearchSeriesInputSpecV1 {
  type: 'series';
  id: string;
  source: ResearchSeriesSourceV1;
  measure: string;
  transform: ResearchTransformV1;
  label?: string;
}

export interface ResearchUniverseInputSpecV1 {
  type: 'universe';
  id: string;
  universe: UniverseSpecV1;
  measure: ResearchUniverseMeasureRefV1;
  label?: string;
}

export interface ResearchEventSetInputSpecV1 {
  type: 'event_set';
  id: string;
  source: {
    kind: 'dividend_proposal_announcement';
    entities: ResearchEntityRefV1[];
  };
  label?: string;
}

export type ResearchInputSpecV1 =
  | ResearchSeriesInputSpecV1
  | ResearchUniverseInputSpecV1
  | ResearchEventSetInputSpecV1;

export interface TimeSeriesRelationshipQuestionSpecV1 {
  version: 1;
  kind: 'time_series_relationship';
  text: string;
  hypothesis: {
    estimand: 'regression_slope';
    direction: 'positive' | 'negative' | 'two_sided';
    nullValue: 0;
  };
}

export interface MultivariateTimeSeriesQuestionSpecV1 {
  version: 1;
  kind: 'multivariate_time_series_relationship';
  text: string;
  hypothesis: {
    estimand: 'partial_regression_coefficient';
    focalPredictor: string;
    direction: 'positive' | 'negative' | 'two_sided';
    nullValue: 0;
  };
}

export interface DistributionComparisonQuestionSpecV1 {
  version: 1;
  kind: 'distribution_comparison';
  text: string;
  hypothesis: {
    estimand: 'mean_difference';
    direction: 'group_a_higher' | 'group_a_lower' | 'two_sided';
    nullValue: 0;
  };
}

export interface EventStudyQuestionSpecV1 {
  version: 1;
  kind: 'event_study';
  text: string;
  hypothesis: {
    estimand: 'mean_cumulative_abnormal_return';
    direction: 'positive' | 'negative' | 'two_sided';
    nullValue: 0;
  };
}

export type ResearchQuestionSpecV1 =
  | TimeSeriesRelationshipQuestionSpecV1
  | MultivariateTimeSeriesQuestionSpecV1
  | DistributionComparisonQuestionSpecV1
  | EventStudyQuestionSpecV1;

export interface TimeSeriesRelationshipProtocolSpecV1 {
  kind: 'time_series_relationship';
  version: 1;
  predictor: string;
  outcome: string;
  predictorLag: number;
  correlations: Array<'pearson' | 'spearman'>;
  inference: { kind: 'newey_west'; lag: 'automatic' | number };
  rollingWindow?: number;
}

export interface MultivariateTimeSeriesPredictorSpecV1 {
  input: string;
  role: 'focal' | 'control';
  lag: number;
}

export interface MultivariateTimeSeriesProtocolSpecV1 {
  kind: 'multivariate_time_series_relationship';
  version: 1;
  outcome: string;
  predictors: MultivariateTimeSeriesPredictorSpecV1[];
  inference: { kind: 'newey_west'; lag: 'automatic' | number };
  rollingWindow?: number;
}

export interface DistributionComparisonProtocolSpecV1 {
  kind: 'distribution_comparison';
  version: 1;
  groupA: string;
  groupB: string;
  measure: ResearchUniverseMeasureRefV1;
  inference: { kind: 'welch'; confidenceLevel: 0.95 };
  sensitivity: { kind: 'winsorized_mean'; tailFraction: number };
}

export interface EventStudyProtocolSpecV1 {
  kind: 'event_study';
  version: 1;
  eventSet: string;
  benchmark: string;
  eventWindow: { start: number; end: number };
  returnModel: 'market_adjusted';
  overlappingEvents: 'keep_first';
  inference: {
    kind: 'event_cluster_mean';
    clusterBy: 'event_trade_date';
    confidenceLevel: 0.95;
  };
}

export type ResearchProtocolSpecV1 =
  | TimeSeriesRelationshipProtocolSpecV1
  | MultivariateTimeSeriesProtocolSpecV1
  | DistributionComparisonProtocolSpecV1
  | EventStudyProtocolSpecV1;

export type ResearchOutputKindV1 =
  | 'summary_table'
  | 'scatter'
  | 'rolling_relationship'
  | 'coefficient_plot'
  | 'partial_regression'
  | 'correlation_matrix'
  | 'rolling_coefficients'
  | 'distribution_boxplot'
  | 'sensitivity'
  | 'event_path'
  | 'event_table'
  | 'conclusion'
  | 'formula'
  | 'python_example'
  | 'documentation';

export interface TimeSeriesRelationshipPlanSpecV1 {
  version: 1;
  question: TimeSeriesRelationshipQuestionSpecV1;
  start: TradeDate;
  end: TradeDate;
  universe?: UniverseSpecV1;
  inputs: ResearchSeriesInputSpecV1[];
  alignment: {
    frequency: ResearchFrequencyV1;
    join: 'inner';
    partialPeriod: 'exclude' | 'include';
  };
  protocol: TimeSeriesRelationshipProtocolSpecV1;
  outputs: Array<{ kind: ResearchOutputKindV1 }>;
}

export interface MultivariateTimeSeriesPlanSpecV1 {
  version: 1;
  question: MultivariateTimeSeriesQuestionSpecV1;
  start: TradeDate;
  end: TradeDate;
  inputs: ResearchSeriesInputSpecV1[];
  alignment: {
    frequency: ResearchFrequencyV1;
    join: 'inner';
    partialPeriod: 'exclude' | 'include';
  };
  protocol: MultivariateTimeSeriesProtocolSpecV1;
  outputs: Array<{ kind: ResearchOutputKindV1 }>;
}

export interface DistributionComparisonPlanSpecV1 {
  version: 1;
  question: DistributionComparisonQuestionSpecV1;
  inputs: ResearchUniverseInputSpecV1[];
  protocol: DistributionComparisonProtocolSpecV1;
  outputs: Array<{ kind: ResearchOutputKindV1 }>;
}

export interface EventStudyPlanSpecV1 {
  version: 1;
  question: EventStudyQuestionSpecV1;
  start: TradeDate;
  end: TradeDate;
  inputs: [ResearchEventSetInputSpecV1, ResearchSeriesInputSpecV1];
  protocol: EventStudyProtocolSpecV1;
  outputs: Array<{ kind: ResearchOutputKindV1 }>;
}

export type ResearchPlanSpecV1 =
  | TimeSeriesRelationshipPlanSpecV1
  | MultivariateTimeSeriesPlanSpecV1
  | DistributionComparisonPlanSpecV1
  | EventStudyPlanSpecV1;

export interface ResearchMeasureDefinitionV1 {
  id: string;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  unit: string;
  sourceKinds: ResearchSeriesSourceV1['kind'][];
  assetTypes?: ResearchAssetTypeV1[];
  transforms: ResearchTransformV1[];
  pointInTime: boolean;
  version: number;
}

export interface ResearchFormulaDefinitionV1 {
  id: string;
  group: ResearchFormulaGroupV1;
  labelZh: string;
  labelEn: string;
  latex: string;
  variables: Array<{ symbol: string; descriptionZh: string; descriptionEn: string }>;
}

export type ResearchFormulaGroupV1 = 'core_estimate' | 'inference' | 'robustness';

export interface ResearchProtocolAssumptionV1 {
  id: string;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}

export interface ResearchProtocolParameterDefinitionV1 {
  id: string;
  type: 'integer' | 'number' | 'enum';
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
  adjustable: boolean;
}

export interface ResearchProtocolTermV1 {
  id: string;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}

export interface ResearchProtocolDefinitionV1 {
  id: ResearchProtocolSpecV1['kind'];
  version: number;
  nameZh: string;
  nameEn: string;
  questionKinds: ResearchQuestionKindV1[];
  minimumObservations: number;
  assumptions: ResearchProtocolAssumptionV1[];
  parameters: ResearchProtocolParameterDefinitionV1[];
  terminology: ResearchProtocolTermV1[];
  formulae: ResearchFormulaDefinitionV1[];
  pythonExample: string;
  helpSlugs: { zh: string[]; en: string[] };
}

export interface ResearchCapabilityCatalogV1 {
  version: 1;
  measures: ResearchMeasureDefinitionV1[];
  universeMeasures: ResearchUniverseMeasureDefinitionV1[];
  protocols: ResearchProtocolDefinitionV1[];
}

/** Searchable, stable platform object that can be passed to `data.series`. */
export interface ResearchDataCatalogInstrumentV1 {
  kind: 'instrument';
  assetType: ResearchAssetTypeV1;
  identifier: string;
  nameZh: string;
  nameEn?: string;
  description?: string;
  tags: string[];
  continuous?: boolean;
  compatibleMeasureIds: string[];
}

/** One response powers the catalog UI and Monaco's identifier/measure completion. */
export interface ResearchDataCatalogResultV1 {
  version: 1;
  query: string;
  instruments: ResearchDataCatalogInstrumentV1[];
  measures: ResearchMeasureDefinitionV1[];
}

export interface ResearchSeriesCoverageV1 {
  inputId: string;
  observationsLoaded: number;
  observationsAligned: number;
  firstDate: TradeDate | null;
  lastDate: TradeDate | null;
  missingAfterAlignment: number;
}

export interface ResearchUniverseCoverageV1 {
  inputId: string;
  requestedAsOfDate: TradeDate | null;
  asOfDate: TradeDate;
  membershipAsOfDate: TradeDate | null;
  membersResolved: number;
  observationsValid: number;
  missingMeasure: number;
  dataRevision: number;
}

export interface ResearchEventCoverageV1 {
  inputId: string;
  entitiesRequested: number;
  eventsLoaded: number;
  eventsWithTradingDate: number;
  eventsWithCompleteWindow: number;
  overlappingEventsExcluded: number;
  eventsAnalyzed: number;
  firstEventDate: TradeDate | null;
  lastEventDate: TradeDate | null;
}

export type ResearchCoverageV1 =
  | ResearchSeriesCoverageV1
  | ResearchUniverseCoverageV1
  | ResearchEventCoverageV1;

export interface ResearchDataInputFingerprintV1 {
  inputId: string;
  hash: string;
  observations: number;
  firstDate: TradeDate | null;
  lastDate: TradeDate | null;
  dataRevision?: number;
}

export interface ResearchRunFingerprintsV1 {
  version: 1;
  protocol: {
    id: ResearchProtocolSpecV1['kind'];
    version: number;
    appRevision: string;
    implementationHash: string;
  };
  data: {
    hash: string;
    inputs: ResearchDataInputFingerprintV1[];
  };
  environment: {
    hash: string;
    nodeVersion: string;
    platform: string;
    architecture: string;
  };
}

export interface ResearchRelationshipRegressionV1 {
  intercept: number;
  slope: number;
  rSquared: number;
  slopeStandardError: number;
  slopeTStatistic: number;
  slopeConfidenceInterval95: { lower: number; upper: number };
  neweyWestLag: number;
}

export interface ResearchRelationshipPointV1 {
  date: TradeDate;
  predictor: number;
  outcome: number;
}

export interface ResearchRollingRelationshipPointV1 {
  date: TradeDate;
  observations: number;
  pearson: number | null;
  spearman: number | null;
  slope: number | null;
}

export interface TimeSeriesRelationshipResultV1 {
  kind: 'time_series_relationship';
  version: 1;
  observations: number;
  pearson: number | null;
  spearman: number | null;
  regression: ResearchRelationshipRegressionV1;
  points: ResearchRelationshipPointV1[];
  rolling: ResearchRollingRelationshipPointV1[];
}

export interface ResearchMultivariateCoefficientV1 {
  inputId: string;
  role: 'focal' | 'control';
  lag: number;
  estimate: number;
  standardError: number;
  tStatistic: number;
  confidenceInterval95: { lower: number; upper: number };
  standardizedEstimate: number;
  standardizedConfidenceInterval95: { lower: number; upper: number };
  partialRSquared: number;
  varianceInflationFactor: number;
}

export interface ResearchMultivariatePointV1 {
  date: TradeDate;
  outcome: number;
  predictors: Record<string, number>;
}

export interface ResearchPartialRegressionPointV1 {
  date: TradeDate;
  focalResidual: number;
  outcomeResidual: number;
}

export interface ResearchRollingCoefficientPointV1 {
  date: TradeDate;
  observations: number;
  estimate: number;
  confidenceInterval95: { lower: number; upper: number };
  rSquared: number;
}

export interface MultivariateTimeSeriesRelationshipResultV1 {
  kind: 'multivariate_time_series_relationship';
  version: 1;
  observations: number;
  intercept: number;
  rSquared: number;
  adjustedRSquared: number;
  neweyWestLag: number;
  residualLag1Autocorrelation: number | null;
  coefficients: ResearchMultivariateCoefficientV1[];
  predictorCorrelations: Array<{ leftInputId: string; rightInputId: string; value: number }>;
  points: ResearchMultivariatePointV1[];
  partialRegression: ResearchPartialRegressionPointV1[];
  rolling: ResearchRollingCoefficientPointV1[];
}

export interface ResearchDistributionSummaryV1 {
  count: number;
  mean: number;
  standardDeviation: number;
  minimum: number;
  firstQuartile: number;
  median: number;
  thirdQuartile: number;
  maximum: number;
  winsorizedMean: number;
}

export interface ResearchDistributionObservationV1 {
  entity: ResearchEntityRefV1;
  name: string;
  value: number;
}

export interface ResearchDistributionGroupV1 {
  inputId: string;
  label: string;
  summary: ResearchDistributionSummaryV1;
  observations: ResearchDistributionObservationV1[];
}

export interface DistributionComparisonResultV1 {
  kind: 'distribution_comparison';
  version: 1;
  observations: number;
  measure: ResearchUniverseMeasureDefinitionV1;
  groups: [ResearchDistributionGroupV1, ResearchDistributionGroupV1];
  comparison: {
    meanDifference: number;
    meanDifferenceStandardError: number;
    meanDifferenceConfidenceInterval95: { lower: number; upper: number };
    welchTStatistic: number;
    welchDegreesOfFreedom: number;
    mannWhitneyU: number;
    mannWhitneyZ: number;
    mannWhitneyTwoSidedPApprox: number;
    cohensD: number;
    cliffsDelta: number;
    winsorizedMeanDifference: number;
  };
}

export interface ResearchEventStudyEventV1 {
  id: string;
  entity: ResearchEntityRefV1;
  announcementDate: TradeDate;
  eventTradeDate: TradeDate;
  reportPeriod: TradeDate;
  cumulativeAbnormalReturn: number;
}

export interface ResearchEventStudyPathPointV1 {
  relativeDay: number;
  observations: number;
  averageAbnormalReturn: number;
  cumulativeAverageAbnormalReturn: number;
  cumulativeConfidenceInterval95: { lower: number; upper: number };
}

export interface EventStudyResultV1 {
  kind: 'event_study';
  version: 1;
  observations: number;
  eventWindow: { start: number; end: number };
  returnModel: 'market_adjusted';
  events: ResearchEventStudyEventV1[];
  path: ResearchEventStudyPathPointV1[];
  aggregate: {
    meanCumulativeAbnormalReturn: number;
    medianCumulativeAbnormalReturn: number;
    standardDeviation: number;
    standardError: number;
    eventDateClusters: number;
    tStatistic: number;
    confidenceInterval95: { lower: number; upper: number };
    positiveFraction: number;
    winsorizedMeanCumulativeAbnormalReturn: number;
  };
}

export type ResearchProtocolResultV1 =
  | TimeSeriesRelationshipResultV1
  | MultivariateTimeSeriesRelationshipResultV1
  | DistributionComparisonResultV1
  | EventStudyResultV1;

export type ResearchConclusionLevelV1 =
  | 'supports'
  | 'weak_support'
  | 'does_not_support'
  | 'indeterminate';

export interface TimeSeriesRelationshipConclusionV1 {
  version: 1;
  level: ResearchConclusionLevelV1;
  direction: 'positive' | 'negative' | 'none';
  estimand: 'regression_slope';
  estimate: number;
  confidenceInterval95: { lower: number; upper: number };
  intervalExcludesNull: boolean;
  hypothesisDirectionMatches: boolean;
  effectSize: {
    metric: 'pearson' | 'spearman';
    value: number;
    magnitude: 'negligible' | 'small' | 'moderate' | 'large';
  };
  stability: {
    method: 'rolling_sign_consistency';
    windows: number;
    consistentFraction: number | null;
    assessment: 'stable' | 'unstable' | 'not_assessed';
  };
  rationaleCodes: string[];
  summaryZh: string;
  summaryEn: string;
  limitationsZh: string[];
  limitationsEn: string[];
}

export interface MultivariateTimeSeriesConclusionV1 {
  version: 1;
  level: ResearchConclusionLevelV1;
  direction: 'positive' | 'negative' | 'none';
  estimand: 'partial_regression_coefficient';
  focalPredictor: string;
  estimate: number;
  confidenceInterval95: { lower: number; upper: number };
  intervalExcludesNull: boolean;
  hypothesisDirectionMatches: boolean;
  effectSize: {
    metric: 'partial_r_squared';
    value: number;
    magnitude: 'negligible' | 'small' | 'moderate' | 'large';
  };
  stability: {
    method: 'rolling_sign_consistency';
    windows: number;
    consistentFraction: number | null;
    assessment: 'stable' | 'unstable' | 'not_assessed';
  };
  rationaleCodes: string[];
  summaryZh: string;
  summaryEn: string;
  limitationsZh: string[];
  limitationsEn: string[];
}

export interface DistributionComparisonConclusionV1 {
  version: 1;
  level: ResearchConclusionLevelV1;
  direction: 'group_a_higher' | 'group_a_lower' | 'none';
  estimand: 'mean_difference';
  estimate: number;
  confidenceInterval95: { lower: number; upper: number };
  intervalExcludesNull: boolean;
  hypothesisDirectionMatches: boolean;
  effectSize: {
    metric: 'cohens_d';
    value: number;
    magnitude: 'negligible' | 'small' | 'moderate' | 'large';
  };
  robustness: {
    method: 'winsorized_mean_direction';
    winsorizedMeanDifference: number;
    directionMatches: boolean;
    assessment: 'consistent' | 'sensitive';
  };
  rationaleCodes: string[];
  summaryZh: string;
  summaryEn: string;
  limitationsZh: string[];
  limitationsEn: string[];
}

export interface EventStudyConclusionV1 {
  version: 1;
  level: ResearchConclusionLevelV1;
  direction: 'positive' | 'negative' | 'none';
  estimand: 'mean_cumulative_abnormal_return';
  estimate: number;
  confidenceInterval95: { lower: number; upper: number };
  intervalExcludesNull: boolean;
  hypothesisDirectionMatches: boolean;
  effectSize: {
    metric: 'standardized_mean_car';
    value: number;
    magnitude: 'negligible' | 'small' | 'moderate' | 'large';
  };
  robustness: {
    method: 'winsorized_mean_direction';
    winsorizedEstimate: number;
    directionMatches: boolean;
    positiveFraction: number;
    assessment: 'consistent' | 'sensitive';
  };
  rationaleCodes: string[];
  summaryZh: string;
  summaryEn: string;
  limitationsZh: string[];
  limitationsEn: string[];
}

export type ResearchConclusionV1 =
  | TimeSeriesRelationshipConclusionV1
  | MultivariateTimeSeriesConclusionV1
  | DistributionComparisonConclusionV1
  | EventStudyConclusionV1;

export interface ResearchDiagnosticV1 {
  code: string;
  severity: 'info' | 'warning' | 'error';
  messageZh: string;
  messageEn: string;
}

export interface TimeSeriesRelationshipRunResultV1 {
  version: 1;
  plan: TimeSeriesRelationshipPlanSpecV1;
  protocol: ResearchProtocolDefinitionV1;
  coverage: ResearchSeriesCoverageV1[];
  result: TimeSeriesRelationshipResultV1;
  conclusion: TimeSeriesRelationshipConclusionV1;
  diagnostics: ResearchDiagnosticV1[];
  fingerprints?: ResearchRunFingerprintsV1;
}

export interface MultivariateTimeSeriesRunResultV1 {
  version: 1;
  plan: MultivariateTimeSeriesPlanSpecV1;
  protocol: ResearchProtocolDefinitionV1;
  coverage: ResearchSeriesCoverageV1[];
  result: MultivariateTimeSeriesRelationshipResultV1;
  conclusion: MultivariateTimeSeriesConclusionV1;
  diagnostics: ResearchDiagnosticV1[];
  fingerprints?: ResearchRunFingerprintsV1;
}

export interface DistributionComparisonRunResultV1 {
  version: 1;
  plan: DistributionComparisonPlanSpecV1;
  protocol: ResearchProtocolDefinitionV1;
  coverage: ResearchUniverseCoverageV1[];
  result: DistributionComparisonResultV1;
  conclusion: DistributionComparisonConclusionV1;
  diagnostics: ResearchDiagnosticV1[];
  fingerprints?: ResearchRunFingerprintsV1;
}

export interface EventStudyRunResultV1 {
  version: 1;
  plan: EventStudyPlanSpecV1;
  protocol: ResearchProtocolDefinitionV1;
  coverage: [ResearchEventCoverageV1, ResearchSeriesCoverageV1];
  result: EventStudyResultV1;
  conclusion: EventStudyConclusionV1;
  diagnostics: ResearchDiagnosticV1[];
  fingerprints?: ResearchRunFingerprintsV1;
}

export type ResearchRunResultV1 =
  | TimeSeriesRelationshipRunResultV1
  | MultivariateTimeSeriesRunResultV1
  | DistributionComparisonRunResultV1
  | EventStudyRunResultV1;

/** Stable identity for a persisted immutable run. Legacy chat parts may not have this reference. */
export interface ResearchRunRecordRefV1 {
  version: 1;
  studyId: string;
  runId: string;
  sequence: number;
  createdAt: string;
}

export interface ResearchRunRecordV1 {
  ref: ResearchRunRecordRefV1;
  title: string;
  origin: 'agent' | 'workbench' | 'parameter_rerun';
  parentRunId?: string;
  planHash: string;
  resultHash: string;
  run: ResearchRunResultV1;
  comparisonToParent?: ResearchRunComparisonV1;
}

export type ResearchRunChangeKindV1 =
  | 'parameters'
  | 'protocol'
  | 'implementation'
  | 'data'
  | 'environment';

export interface ResearchRunComparisonV1 {
  version: 1;
  baseRunId: string;
  candidateRunId: string;
  changes: ResearchRunChangeKindV1[];
  planChanges: ResearchPlanChangeV1[];
  planChangesTruncated: boolean;
  resultChanged: boolean;
  conclusionChanged: boolean;
  attribution: 'unchanged' | ResearchRunChangeKindV1 | 'multiple' | 'unavailable';
}

export interface ResearchPlanChangeV1 {
  path: string;
  before: string;
  after: string;
}

export interface ResearchAttemptRecordV1 {
  version: 1;
  id: string;
  studyId?: string;
  parentRunId?: string;
  origin: 'agent' | 'parameter_rerun';
  plan?: ResearchPlanSpecV1;
  planHash?: string;
  error: string;
  createdAt: string;
  planChanges: ResearchPlanChangeV1[];
  planChangesTruncated: boolean;
}

export type ResearchCuratorFindingCategoryV1 =
  | 'protocol_candidate'
  | 'supplier_data_gap'
  | 'local_capability_gap'
  | 'documentation_gap'
  | 'tool_or_interaction_defect'
  | 'no_action';

export type ResearchCuratorDispositionV1 =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'duplicate';

export interface ResearchCuratorEvidenceV1 {
  id: string;
  sourceType: 'message' | 'tool_failure' | 'research_attempt';
  sourceId: string;
  conversationId: string;
  occurredAt: string;
  excerpt: string;
  signals: string[];
}

export interface ResearchCuratorVerificationMatchV1 {
  kind:
    | 'research_measure'
    | 'research_protocol'
    | 'data_contract'
    | 'data_source_decision'
    | 'local_data_table'
    | 'tushare_api'
    | 'code_reference'
    | 'help_article'
    | 'roadmap_item'
    | 'design_document'
    | 'prior_finding';
  id: string;
}

export type ResearchCuratorVerificationNoteV1 =
  | 'local_capability_match'
  | 'tushare_catalog_match_requires_smoke_check'
  | 'tushare_probe_available'
  | 'tushare_probe_permission_denied'
  | 'tushare_probe_empty'
  | 'tushare_api_unverified'
  | 'local_capability_unverified'
  | 'cross_market_contract_match'
  | 'source_decision_match'
  | 'repository_reference_match';

export interface ResearchCuratorVerificationEvidenceV1 {
  stance: 'supports' | 'limits';
  kind: 'catalog' | 'probe' | 'repository';
  reference: string;
  detailZh: string;
  detailEn: string;
}

export type ResearchCuratorVerificationAssessmentV1 = 'correct' | 'incorrect';

export interface ResearchCuratorQualityMetricsV1 {
  totalFindings: number;
  pending: number;
  deferred: number;
  reviewed: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  duplicatesSkipped: number;
  acceptanceRate: number | null;
  duplicateRate: number | null;
  verificationAssessments: number;
  verificationErrors: number;
  verificationErrorRate: number | null;
  evaluationReady: boolean;
  minimumReviewedFindings: number;
  minimumVerificationAssessments: number;
}

export interface ResearchCuratorFindingV1 {
  version: 1;
  id: string;
  runId: string;
  category: ResearchCuratorFindingCategoryV1;
  title: string;
  summary: string;
  evidence: ResearchCuratorEvidenceV1[];
  verification: {
    status: 'verified' | 'partial' | 'unverified' | 'duplicate';
    matches: ResearchCuratorVerificationMatchV1[];
    notes: ResearchCuratorVerificationNoteV1[];
    evidence: ResearchCuratorVerificationEvidenceV1[];
  };
  confidence: number;
  expectedValue: string;
  changeSurface: string[];
  suggestedAction: string;
  fingerprint: string;
  disposition: ResearchCuratorDispositionV1;
  dispositionNote?: string;
  disposedAt?: string;
  verificationAssessment?: ResearchCuratorVerificationAssessmentV1;
  verificationAssessedAt?: string;
  createdAt: string;
}

export interface ResearchCuratorRunV1 {
  version: 1;
  id: string;
  jobId?: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'stale';
  trigger: 'manual' | 'scheduled';
  cursorFrom?: string;
  cursorTo: string;
  evidenceCount: number;
  findingsCreated: number;
  duplicatesSkipped: number;
  quality: ResearchCuratorQualityMetricsV1;
  error?: string;
  findings: ResearchCuratorFindingV1[];
  createdAt: string;
}

export interface ResearchConversationMeta {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchConversationMessages {
  messages: import('./chat.js').ChatMessage[];
  nextBefore?: number;
}

// —— Reactive research workbench ——

export type ResearchCellKindV1 = 'markdown' | 'python' | 'validation';
export type ResearchCellStatusV1 = 'idle' | 'running' | 'success' | 'error' | 'stale';
export type ResearchCellScalarV1 = string | number | boolean | null;
export type ResearchChartKindV1 = ChartKind | 'boxplot' | 'heatmap' | 'event_path';

export interface ResearchTableOutputV1 {
  type: 'table';
  columns: string[];
  rows: Record<string, ResearchCellScalarV1>[];
  rowCount: number;
  truncated: boolean;
}

/** Inline chart data is an execution artifact, unlike conversation ChartSpec queries which rerun. */
export interface ResearchChartOutputV1 {
  type: 'chart';
  version: 1;
  title?: string;
  kind: ResearchChartKindV1;
  x: string;
  y?: string;
  series: ChartSeriesSpec[];
  rows: Record<string, ResearchCellScalarV1>[];
}

export type ResearchCellOutputBlockV1 =
  | { type: 'text'; text: string; level?: 'info' | 'warning' | 'error' }
  | { type: 'value'; value: ResearchCellScalarV1 | ResearchCellScalarV1[] }
  | ResearchTableOutputV1
  | ResearchChartOutputV1
  | { type: 'image'; mimeType: 'image/png' | 'image/svg+xml'; dataUrl: string; alt?: string }
  | {
      type: 'validation';
      title: string;
      run: ResearchRunResultV1;
      record: ResearchRunRecordRefV1;
    };

export interface ResearchCellV1 {
  version: 1;
  id: string;
  documentId: string;
  position: number;
  kind: ResearchCellKindV1;
  source: string;
  config?: Record<string, unknown>;
  status: ResearchCellStatusV1;
  revision: number;
  definitions: string[];
  references: string[];
  outputs: ResearchCellOutputBlockV1[];
  lastExecutedRevision?: number;
  lastExecutedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchDocumentSummaryV1 extends ResearchConversationMeta {
  cellCount: number;
  staleCount: number;
}

export interface ResearchDocumentV1 {
  version: 1;
  id: string;
  conversationId: string;
  title: string;
  runtimeVersion: 'research-py-v1';
  cells: ResearchCellV1[];
  messages: import('./chat.js').ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchDependencyConflictV1 {
  name: string;
  cellIds: string[];
}

export interface ResearchDocumentAnalysisV1 {
  version: 1;
  cells: Array<{ cellId: string; definitions: string[]; references: string[] }>;
  conflicts: ResearchDependencyConflictV1[];
}

export type ResearchDocumentTemplateV1 = 'blank' | 'index_relationship';

export interface ResearchDocumentRunResultV1 {
  version: 1;
  document: ResearchDocumentV1;
  executedCellIds: string[];
  clean: boolean;
}

export interface ResearchDocumentInterruptResultV1 {
  version: 1;
  document: ResearchDocumentV1;
  interrupted: boolean;
}
