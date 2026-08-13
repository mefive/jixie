import type { TradeDate } from './types.js';

export type ResearchAssetTypeV1 = 'stock' | 'etf' | 'index' | 'future';
export type ResearchFrequencyV1 = 'daily' | 'monthly';
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
  op: '>' | '>=' | '<' | '<=' | '==' | '!=';
  value: number | string;
}

/** A point-in-time entity selector. Resolution freezes the resulting members on every ResearchRun. */
export interface UniverseSpecV1 {
  version: 1;
  source: ResearchEntitySetSourceV1;
  asOf: ResearchAsOfSpecV1;
  predicates: ResearchMeasurePredicateV1[];
  missing: 'exclude';
  sort?: { measure: string; direction: 'asc' | 'desc' };
  limit?: number;
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
  | 'formula'
  | 'python_example'
  | 'documentation';

export interface ResearchPlanSpecV1 {
  version: 1;
  question: string;
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

export interface ResearchProtocolDefinitionV1 {
  id: ResearchProtocolSpecV1['kind'];
  version: number;
  nameZh: string;
  nameEn: string;
  minimumObservations: number;
  formulae: ResearchFormulaDefinitionV1[];
  pythonExample: string;
  helpSlugs: { zh: string[]; en: string[] };
}

export interface ResearchCapabilityCatalogV1 {
  version: 1;
  measures: ResearchMeasureDefinitionV1[];
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
  result: TimeSeriesRelationshipResultV1;
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
