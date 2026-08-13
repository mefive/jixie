import type { TradeDate } from './types.js';

export type ResearchAssetTypeV1 = 'stock' | 'etf' | 'index' | 'future';
export type ResearchFrequencyV1 = 'daily' | 'monthly';
export type ResearchQuestionKindV1 =
  | 'time_series_relationship'
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

export type ResearchInputSpecV1 = ResearchSeriesInputSpecV1;

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

export type ResearchQuestionSpecV1 = TimeSeriesRelationshipQuestionSpecV1;

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

export type ResearchProtocolSpecV1 = TimeSeriesRelationshipProtocolSpecV1;

export type ResearchOutputKindV1 =
  | 'summary_table'
  | 'scatter'
  | 'rolling_relationship'
  | 'conclusion'
  | 'formula'
  | 'python_example'
  | 'documentation';

export interface ResearchPlanSpecV1 {
  version: 1;
  question: ResearchQuestionSpecV1;
  start: TradeDate;
  end: TradeDate;
  universe?: UniverseSpecV1;
  inputs: ResearchInputSpecV1[];
  alignment: {
    frequency: ResearchFrequencyV1;
    join: 'inner';
    partialPeriod: 'exclude' | 'include';
  };
  protocol: ResearchProtocolSpecV1;
  outputs: Array<{ kind: ResearchOutputKindV1 }>;
}

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
  labelZh: string;
  labelEn: string;
  latex: string;
  variables: Array<{ symbol: string; descriptionZh: string; descriptionEn: string }>;
}

export interface ResearchProtocolAssumptionV1 {
  id: string;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}

export interface ResearchProtocolParameterDefinitionV1 {
  id: string;
  type: 'integer' | 'enum';
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

export interface ResearchSeriesCoverageV1 {
  inputId: string;
  observationsLoaded: number;
  observationsAligned: number;
  firstDate: TradeDate | null;
  lastDate: TradeDate | null;
  missingAfterAlignment: number;
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

export type ResearchProtocolResultV1 = TimeSeriesRelationshipResultV1;

export type ResearchConclusionLevelV1 =
  | 'supports'
  | 'weak_support'
  | 'does_not_support'
  | 'indeterminate';

export interface ResearchConclusionV1 {
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

export interface ResearchDiagnosticV1 {
  code: string;
  severity: 'info' | 'warning' | 'error';
  messageZh: string;
  messageEn: string;
}

export interface ResearchRunResultV1 {
  version: 1;
  plan: ResearchPlanSpecV1;
  protocol: ResearchProtocolDefinitionV1;
  coverage: ResearchSeriesCoverageV1[];
  result: ResearchProtocolResultV1;
  conclusion: ResearchConclusionV1;
  diagnostics: ResearchDiagnosticV1[];
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
