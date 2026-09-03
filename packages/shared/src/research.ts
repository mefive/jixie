import type { TradeDate } from './types.js';
import type { ChartKind, ChartSeriesSpec } from './chart.js';
import type {
  FactorAnalysisKind,
  FactorEquityIndexCode,
  FactorExpectedDirection,
  FactorLanguage,
} from './factor.js';
import type { StrategyLanguage } from './backtest.js';
import type {
  ResearchFxSeriesIdV1,
  ResearchMacroSeriesKeyV1,
  ResearchMarketStateScopeV1,
  ResearchCommodityHoldingProductCodeV1,
  ResearchCommodityProductCodeV1,
  ResearchYieldCurveCodeV1,
  ResearchYieldTenorV1,
} from './research-sdk-contract.js';

export type ResearchAssetTypeV1 = 'stock' | 'etf' | 'index' | 'future';
export type ResearchDataCatalogScopeV1 =
  | 'instruments'
  | 'datasets'
  | 'factor_reports'
  | 'backtest_reports';
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

/** A point-in-time entity selector used by screening and Python research. */
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

export interface ResearchCapabilityCatalogV1 {
  version: 1;
  measures: ResearchMeasureDefinitionV1[];
  universeMeasures: ResearchUniverseMeasureDefinitionV1[];
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
  localDataCoverage?: ResearchDataCatalogCoverageV1;
  sdkAccess?: ResearchDataCatalogSdkAccessV1;
  researchRegistry?: ResearchDataCatalogRegistryV1 | null;
}

export type ResearchDataCatalogCoverageV1 =
  | {
      status: 'ready';
      observationCount: number;
      startDate: string;
      endDate: string;
      dateBasis: 'tradeDate' | 'availableDate';
    }
  | {
      status: 'missing';
      reason: 'source_available_but_local_data_missing';
    };

export type ResearchDataCatalogSdkAccessV1 =
  | { status: 'ready'; method: 'data.series' }
  | {
      status: 'not_ready';
      reason: 'source_available_but_local_data_missing';
    };

export interface ResearchDataCatalogRegistryV1 {
  exposureId: string;
  role: 'primary' | 'backup';
  region: string;
  currencyExposure: string;
  selectionAsOf: string;
  knownLimitations: readonly string[];
}

export interface ResearchDataCatalogSdkMethodV1 {
  qualifiedName: string;
  name: string;
  descriptionZh: string;
  descriptionEn: string;
  signature: string;
  example: string;
  returnColumns: string[];
}

export type ResearchDataCatalogDatasetCoverageV1 =
  | {
      status: 'ready';
      startDate: string;
      endDate: string;
      dateBasis: 'tradeDate' | 'availableDate';
    }
  | {
      status: 'missing';
      reason: 'source_available_but_local_data_missing';
    };

interface ResearchDataCatalogDatasetBaseV1 {
  kind: 'dataset';
  id: string;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  tags: string[];
  localDataCoverage: ResearchDataCatalogDatasetCoverageV1;
}

/** A governed, locally available dataset that can be inserted as an exact SDK call. */
export type ResearchDataCatalogDatasetV1 =
  | (ResearchDataCatalogDatasetBaseV1 & {
      method: 'data.cross_section' | 'data.panel';
      universe: string;
    })
  | (ResearchDataCatalogDatasetBaseV1 & {
      method: 'data.yield_curve';
      curve: ResearchYieldCurveCodeV1;
      tenor: ResearchYieldTenorV1;
    })
  | (ResearchDataCatalogDatasetBaseV1 & {
      method: 'data.macro';
      series: ResearchMacroSeriesKeyV1;
    })
  | (ResearchDataCatalogDatasetBaseV1 & {
      method: 'data.fx';
      pair: ResearchFxSeriesIdV1;
    })
  | (ResearchDataCatalogDatasetBaseV1 & {
      method: 'data.commodity_returns' | 'data.commodity_warehouse_receipts';
      product: ResearchCommodityProductCodeV1;
    })
  | (ResearchDataCatalogDatasetBaseV1 & {
      method: 'data.commodity_holdings';
      product: ResearchCommodityHoldingProductCodeV1;
    })
  | (ResearchDataCatalogDatasetBaseV1 & {
      method: 'data.market_state';
      scope: ResearchMarketStateScopeV1;
    })
  | (ResearchDataCatalogDatasetBaseV1 & {
      method:
        | 'data.etf_shares'
        | 'data.index_valuation'
        | 'data.industry_state'
        | 'data.futures_settlement';
      identifier: string;
    });

/** A completed FactorReport owned by the current user and discoverable from Research. */
export interface ResearchDataCatalogFactorReportV1 {
  kind: 'factor_report';
  id: string;
  factor: string;
  factorName: string;
  analysisKind: FactorAnalysisKind;
  phase: 'legacy' | 'explore' | 'holdout';
  sealed: boolean;
  createdAt: string;
  computedAt: string | null;
}

/** A completed BacktestReport owned by the current user and discoverable from Research. */
export interface ResearchDataCatalogBacktestReportV1 {
  kind: 'backtest_report';
  id: string;
  strategyId: string;
  strategyName: string;
  start: string;
  end: string;
  language: StrategyLanguage;
  createdAt: string;
  computedAt: string | null;
}

/** A completed immutable strategy parameter scan owned by the current user. */
export interface ResearchDataCatalogStrategyScanReportV1 {
  kind: 'strategy_scan_report';
  id: string;
  strategyId: string;
  strategyName: string;
  dataCutoff: string | null;
  parameterNames: string[];
  createdAt: string;
  updatedAt: string;
}

/** A ready Factor Weather pin owned by the current user. */
export interface ResearchDataCatalogFactorWeatherV1 {
  kind: 'factor_weather';
  factorId: string;
  factorName: string;
  direction: 'positive' | 'negative';
  computedThrough: string | null;
  pointCount: number;
  createdAt: string;
}

/** One response powers the catalog UI and Monaco's identifier/measure completion. */
export interface ResearchDataCatalogResultV1 {
  version: 1;
  query: string;
  sdkMethods: ResearchDataCatalogSdkMethodV1[];
  instruments: ResearchDataCatalogInstrumentV1[];
  datasets: ResearchDataCatalogDatasetV1[];
  factorReports: ResearchDataCatalogFactorReportV1[];
  factorWeather: ResearchDataCatalogFactorWeatherV1[];
  backtestReports: ResearchDataCatalogBacktestReportV1[];
  strategyScanReports: ResearchDataCatalogStrategyScanReportV1[];
  measures: ResearchMeasureDefinitionV1[];
}

export interface ResearchDiagnosticV1 {
  code: string;
  severity: 'info' | 'warning' | 'error';
  messageZh: string;
  messageEn: string;
}

export type ResearchCuratorFindingCategoryV1 =
  | 'method_candidate'
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
  sourceType: 'message' | 'tool_failure';
  sourceId: string;
  conversationId: string;
  occurredAt: string;
  excerpt: string;
  signals: string[];
}

export interface ResearchCuratorVerificationMatchV1 {
  kind:
    | 'research_measure'
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

export type ResearchCellKindV1 = 'markdown' | 'python';
export type ResearchCellStatusV1 = 'idle' | 'running' | 'success' | 'error' | 'stale';
export type ResearchClarificationStatusV1 = 'pending' | 'answered' | 'superseded';
export type ResearchClarificationSelectionModeV1 = 'single' | 'multiple';
export type ResearchClarificationOptionKindV1 = 'concept' | 'binding' | 'keep_gap';
export type ResearchCellChangeProposalStatusV1 = 'pending' | 'applied' | 'rejected' | 'conflicted';
export type ResearchCellChangeReviewStatusV1 = 'open' | 'accepted' | 'reverted';
export type ResearchCellChangeAttemptStatusV1 = 'running' | 'success' | 'error' | 'cancelled';
export type ResearchCellChangeAttemptScopeV1 = 'affected' | 'clean_document';

export interface ResearchClarificationOptionV1 {
  id: string;
  kind: ResearchClarificationOptionKindV1;
  referenceId?: string;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}

export interface ResearchClarificationQuestionV1 {
  id: string;
  prompt: string;
  selectionMode: ResearchClarificationSelectionModeV1;
  options: ResearchClarificationOptionV1[];
  allowCustom: boolean;
}

export interface ResearchClarificationSelectionV1 {
  questionId: string;
  selectedOptionIds: string[];
  customText?: string;
}

export interface ResearchClarificationAnswerV1 {
  selections: ResearchClarificationSelectionV1[];
  answeredAt: string;
}

export interface ResearchClarificationV1 {
  version: 1;
  id: string;
  documentId: string;
  title: string;
  status: ResearchClarificationStatusV1;
  questions: ResearchClarificationQuestionV1[];
  answer?: ResearchClarificationAnswerV1;
  createdAt: string;
}

interface ResearchCellChangeOperationBaseV1 {
  operationId: string;
  cellId: string;
  cellKind: ResearchCellKindV1;
  position: number;
  addedLines: number;
  removedLines: number;
  afterDefinitions: string[];
  afterReferences: string[];
}

export type ResearchCellChangeOperationV1 =
  | (ResearchCellChangeOperationBaseV1 & {
      kind: 'create';
      afterCellId?: string;
      beforeSource: '';
      afterSource: string;
    })
  | (ResearchCellChangeOperationBaseV1 & {
      kind: 'update';
      expectedRevision: number;
      beforeSource: string;
      afterSource: string;
    })
  | (ResearchCellChangeOperationBaseV1 & {
      kind: 'delete';
      expectedRevision: number;
      beforeSource: string;
      afterSource: '';
    });

export type ResearchCellChangeConflictReasonV1 =
  | 'document_changed'
  | 'document_running'
  | 'cell_missing'
  | 'cell_revision_changed'
  | 'cell_source_changed';

export interface ResearchCellChangeConflictV1 {
  reason: ResearchCellChangeConflictReasonV1;
  cellIds: string[];
}

export interface ResearchCellChangeProposalV1 {
  version: 1;
  id: string;
  documentId: string;
  title: string;
  summary: string;
  status: ResearchCellChangeProposalStatusV1;
  expectedDocumentUpdatedAt: string;
  expectedDocumentContentRevision?: number;
  appliedDocumentContentRevision?: number;
  reviewSessionId?: string;
  reviewSequence?: number;
  reviewStatus?: ResearchCellChangeReviewStatusV1;
  reviewIsLatest?: boolean;
  reviewResolvedAt?: string;
  operations: ResearchCellChangeOperationV1[];
  conflict?: ResearchCellChangeConflictV1;
  createdAt: string;
  resolvedAt?: string;
}

export interface ResearchCellChangeReviewCellV1 {
  cellId: string;
  cellKind: ResearchCellKindV1;
  position: number;
  kind: 'create' | 'update';
  beforeSource: string;
}

export interface ResearchCellChangeReviewV1 {
  version: 1;
  id: string;
  status: 'open';
  proposalIds: string[];
  latestProposalId: string;
  stepCount: number;
  cells: ResearchCellChangeReviewCellV1[];
  createdAt: string;
}

export interface ResearchCellChangeAttemptCellV1 {
  executionId: string;
  cellId: string;
  position: number;
  kind: ResearchCellKindV1;
  revision: number;
  status: ResearchCellChangeAttemptStatusV1;
  sourceHash: string;
  outputHash?: string;
  outputTypes: ResearchCellOutputBlockV1['type'][];
  environmentFingerprint: string;
  error?: string;
}

export interface ResearchCellChangeAttemptComparisonV1 {
  version: 1;
  previousAttemptId: string;
  sourceChangedCellIds: string[];
  outputChangedCellIds: string[];
  statusChanged: boolean;
  environmentChanged: boolean;
}

export interface ResearchCellChangeAttemptV1 {
  version: 1;
  id: string;
  documentId: string;
  proposalId: string;
  contentRevision: number;
  scope: ResearchCellChangeAttemptScopeV1;
  rootCellIds: string[];
  plannedCellIds: string[];
  status: ResearchCellChangeAttemptStatusV1;
  cells: ResearchCellChangeAttemptCellV1[];
  error?: string;
  explanationTurnId?: string;
  comparisonToPrevious?: ResearchCellChangeAttemptComparisonV1;
  startedAt: string;
  finishedAt?: string;
}
export type ResearchCellScalarV1 = string | number | boolean | null;
export type ResearchChartKindV1 = ChartKind | 'boxplot' | 'heatmap' | 'event_path';

export interface ResearchTableOutputV1 {
  type: 'table';
  columns: string[];
  rows: Record<string, ResearchCellScalarV1>[];
  rowCount: number;
  truncated: boolean;
  /** Optional on persisted V1 outputs created before bounded column previews shipped. */
  columnCount?: number;
  truncatedColumns?: boolean;
  truncatedCells?: boolean;
  truncatedBytes?: boolean;
  previewByteSize?: number;
  limits?: {
    rows: number;
    columns: number;
    cellCharacters: number;
    bytes?: number;
  };
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

export type ResearchImageOutputV1 = {
  type: 'image';
  mimeType: 'image/png' | 'image/svg+xml';
  alt?: string;
  byteSize?: number;
  sha256?: string;
  width?: number;
  height?: number;
} & (
  | { dataUrl: string; artifactId?: never }
  | {
      artifactId: string;
      /** Legacy executions use dataUrl; new executions use an authenticated artifact reference. */
      dataUrl?: never;
    }
);

export type ResearchCellOutputBlockV1 =
  | { type: 'text'; text: string; level?: 'info' | 'warning' | 'error' }
  | { type: 'value'; value: ResearchCellScalarV1 | ResearchCellScalarV1[] }
  | ResearchTableOutputV1
  | ResearchChartOutputV1
  | ResearchImageOutputV1;

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

/** Resolve transitive upstream Cell providers in breadth-first order. */
export function researchUpstreamDependencyCellIds(
  cells: Array<{ id: string; definitions: string[]; references: string[] }>,
  rootCellIds: string[],
): string[] {
  const cellById = new Map(cells.map((cell) => [cell.id, cell]));
  const providerCellIdsByDefinition = new Map<string, string[]>();
  for (const cell of cells) {
    for (const definition of cell.definitions) {
      providerCellIdsByDefinition.set(definition, [
        ...(providerCellIdsByDefinition.get(definition) ?? []),
        cell.id,
      ]);
    }
  }

  const visited = new Set(rootCellIds);
  const pending = [...rootCellIds];
  const dependencies: string[] = [];
  while (pending.length > 0) {
    const cell = cellById.get(pending.shift()!);
    if (!cell) {
      continue;
    }
    for (const reference of cell.references) {
      for (const providerCellId of providerCellIdsByDefinition.get(reference) ?? []) {
        if (visited.has(providerCellId)) {
          continue;
        }
        visited.add(providerCellId);
        dependencies.push(providerCellId);
        pending.push(providerCellId);
      }
    }
  }
  return dependencies;
}

export interface ResearchDocumentSummaryV1 extends ResearchConversationMeta {
  cellCount: number;
  staleCount: number;
  archivedAt: string | null;
}

export type ResearchDocumentListStateV1 = 'active' | 'archived';

export interface ResearchDocumentV1 {
  version: 1;
  id: string;
  conversationId: string;
  title: string;
  runtimeVersion: 'research-py-v1';
  contentRevision: number;
  cells: ResearchCellV1[];
  activeCellChangeReview?: ResearchCellChangeReviewV1;
  cellChangeAttempts: ResearchCellChangeAttemptV1[];
  messages: import('./chat.js').ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchCellChangeResolutionResultV1 {
  version: 1;
  outcome: 'applied' | 'rejected' | 'conflicted';
  proposal: ResearchCellChangeProposalV1;
  document: ResearchDocumentV1;
}

export interface ResearchCellChangeReviewResolutionResultV1 {
  version: 1;
  outcome: 'accepted' | 'reverted' | 'conflicted';
  document: ResearchDocumentV1;
}

export interface ResearchCellChangeRunResultV1 {
  version: 1;
  attempt: ResearchCellChangeAttemptV1;
  document: ResearchDocumentV1;
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

export type ResearchExecutionStatusV1 = 'running' | 'success' | 'error' | 'cancelled';

export interface ResearchExecutionDagNodeV1 {
  cellId: string;
  dependsOnCellIds: string[];
}

export interface ResearchExecutionCellV1 {
  version: 1;
  cellId: string;
  position: number;
  kind: ResearchCellKindV1;
  source: string;
  config?: Record<string, unknown>;
  revision: number;
  definitions: string[];
  references: string[];
  status: ResearchExecutionStatusV1 | 'not_run';
  outputs: ResearchCellOutputBlockV1[];
  error?: string;
  environmentFingerprint?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ResearchExecutionSummaryV1 {
  version: 1;
  id: string;
  documentId: string;
  sequence: number;
  title: string;
  contentRevision: number;
  runtimeVersion: 'research-py-v1';
  status: ResearchExecutionStatusV1;
  sourceHash: string;
  environmentFingerprint?: string;
  cellCount: number;
  executedCellCount: number;
  error?: string;
  displayName?: string;
  tags: string[];
  userNote?: string;
  promotedAt?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ResearchExecutionV1 extends ResearchExecutionSummaryV1 {
  cells: ResearchExecutionCellV1[];
  dag: ResearchExecutionDagNodeV1[];
}

export interface ResearchExecutionPromotionInputV1 {
  displayName: string;
  tags: string[];
  userNote?: string;
}

export type ResearchFactorDraftAnalysisKindV1 = Extract<
  FactorAnalysisKind,
  'cross_sectional' | 'time_series' | 'panel'
>;

/** Supported FactorReport inputs recovered from a frozen Research version. Missing fields retain the
 * Factor workbench defaults and remain explicit review work; this suggestion never starts a run. */
export interface ResearchFactorReportSuggestionV1 {
  version: 1;
  analysisKind: ResearchFactorDraftAnalysisKindV1;
  start?: string;
  end?: string;
  observationFrequency?: 'daily' | 'weekly' | 'monthly';
  equityUniverse?: 'cn_a' | FactorEquityIndexCode;
  minimumListingDays?: number;
  excludeRiskWarnings?: boolean;
  assets?: string[];
  hypothesis?: string;
  expectedDirection?: FactorExpectedDirection;
}

/** The durable, human-reviewable handoff from one frozen research version into a Factor draft. */
export interface ResearchFactorHandoffV1 {
  version: 1;
  sourceExecutionId: string;
  sourceDocumentId: string;
  sourceContentRevision: number;
  sourceHash: string;
  sourceDisplayName: string;
  analysisKind: ResearchFactorDraftAnalysisKindV1;
  /** Absent on TypeScript handoffs created before Factor Python support. */
  language?: FactorLanguage;
  summary: string;
  unresolvedItems: string[];
  suggestedReport?: ResearchFactorReportSuggestionV1;
  generatedAt: string;
  models: {
    classifier: string;
    codegen: string;
  };
}

export interface ResearchFactorDraftResultV1 {
  version: 1;
  factorId: string;
  factorKey: string;
  factorName: string;
  analysisKind: ResearchFactorDraftAnalysisKindV1;
  language?: FactorLanguage;
  handoff: ResearchFactorHandoffV1;
  reused: boolean;
}

/** The durable, human-reviewable handoff from one frozen research version into a Strategy draft. */
export interface ResearchStrategyHandoffV1 {
  version: 1;
  sourceExecutionId: string;
  sourceDocumentId: string;
  sourceContentRevision: number;
  sourceHash: string;
  sourceDisplayName: string;
  language: StrategyLanguage;
  summary: string;
  unresolvedItems: string[];
  generatedAt: string;
  models: {
    classifier: string;
    codegen: string;
  };
}

export interface ResearchStrategyDraftResultV1 {
  version: 1;
  strategyId: string;
  strategyName: string;
  language: StrategyLanguage;
  handoff: ResearchStrategyHandoffV1;
  reused: boolean;
}

export interface ResearchDocumentRunResultV1 {
  version: 1;
  document: ResearchDocumentV1;
  executedCellIds: string[];
  clean: boolean;
  execution?: ResearchExecutionSummaryV1;
}

export interface ResearchDocumentInterruptResultV1 {
  version: 1;
  document: ResearchDocumentV1;
  interrupted: boolean;
}
