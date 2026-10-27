import type { TradeDate } from './types.js';
import type { FactorAnalysisKind } from './factor.js';
import type { StrategyLanguage } from './backtest.js';
import type {
  ResearchFxSeriesIdV1,
  ResearchMacroSeriesKeyV1,
  ResearchCommodityHoldingProductCodeV1,
  ResearchCommodityProductCodeV1,
  ResearchYieldCurveCodeV1,
  ResearchYieldTenorV1,
} from './sdk/research/contract.js';

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

/**
 * 携带平台对象的稳定资产身份，供查询与目录。
 *
 * Describe stable platform asset identity for queries and catalogs.
 */
export interface ResearchEntityRefV1 {
  assetType: ResearchAssetTypeV1;
  id: string;
}

/**
 * 指定证券集合来自全市场、指数或明确列表，供时点解析。
 *
 * Define universe sources for point-in-time resolution.
 */
export type ResearchEntitySetSourceV1 =
  | { kind: 'equity_market'; market: 'CN' }
  | { kind: 'index_members'; indexCode: string }
  | { kind: 'explicit'; entities: ResearchEntityRefV1[] };

/**
 * 显式指定历史观察时点，避免默认当前数据。
 *
 * Declare an observation date instead of assuming current data.
 */
export type ResearchAsOfSpecV1 =
  | { kind: 'fixed'; date: TradeDate }
  | { kind: 'latest_available' }
  | { kind: 'periodic'; frequency: 'month_end' };

/**
 * 描述指标比较条件，供受控证券池筛选。
 *
 * Describe measure predicates for governed universe filtering.
 */
export interface ResearchMeasurePredicateV1 {
  measure: string;
  measureVersion: 1;
  op: '>' | '>=' | '<' | '<=' | '==' | '!=';
  value: number | string;
}

/**
 * 绑定证券池指标与所需输入，供筛选读取。
 *
 * Describe universe measures and required inputs for filtering.
 */
export interface ResearchUniverseMeasureRefV1 {
  measure: string;
  measureVersion: 1;
}

/**
 * 冻结上市、风险警示等资格政策，供历史可投资性过滤。
 *
 * Freeze listing and risk-warning policies for dated eligibility.
 */
export interface ResearchUniverseEligibilityV1 {
  minimumListedDays: number;
  suspension: 'exclude';
  riskWarning: 'include' | 'exclude';
}

/**
 * 定义供筛选及 Python 研究共用的时点实体选择器。
 *
 * A point-in-time entity selector used by screening and Python research.
 */
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

/**
 * 声明证券池可用指标及其单位和语义。
 *
 * Define available universe measures, units and semantics.
 */
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

/**
 * 表示已通过筛选的证券及公开指标值。
 *
 * Describe an eligible instrument and public measure values.
 */
export interface ResearchUniverseRowV1 {
  entity: ResearchEntityRefV1;
  name: string;
  industry: string | null;
  values: Record<string, number | null>;
}

/**
 * 记录证券池各筛选阶段的数量，供覆盖解释。
 *
 * Record universe filter-stage counts for coverage interpretation.
 */
export interface ResearchUniverseStageV1 {
  code: 'source' | 'listed' | 'not_suspended' | 'risk_warning' | 'predicates';
  count: number;
}

/**
 * 返回证券池结果、阶段审计与时点信息。
 *
 * Return universe rows, stage audits and as-of metadata.
 */
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

/**
 * 定义受控序列的身份与来源，不接受任意 SQL。
 *
 * Identify a governed series and source without arbitrary SQL.
 */
export type ResearchSeriesSourceV1 =
  | { kind: 'instrument'; assetType: ResearchAssetTypeV1; id: string }
  | { kind: 'macro'; seriesKey: string }
  | { kind: 'yield_curve'; curveCode: string; curveType: string; termYears: number }
  | { kind: 'fx'; id: string };

/**
 * 冻结序列日期、频率和变换，供可复现读取。
 *
 * Freeze series dates, frequency and transforms for reproducible reads.
 */
export interface ResearchSeriesInputSpecV1 {
  type: 'series';
  id: string;
  source: ResearchSeriesSourceV1;
  measure: string;
  transform: ResearchTransformV1;
  label?: string;
}

/**
 * 定义研究指标名称、单位和合法变换。
 *
 * Describe research measures, units and supported transforms.
 */
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

/**
 * 公开研究可用对象、指标与范围，供目录和补全。
 *
 * Describe research objects, measures and scope for catalog and completion.
 */
export interface ResearchCapabilityCatalogV1 {
  version: 1;
  measures: ResearchMeasureDefinitionV1[];
  universeMeasures: ResearchUniverseMeasureDefinitionV1[];
}

/**
 * 定义可传入 data.series 的可搜索稳定平台对象。
 *
 * Searchable, stable platform object that can be passed to `data.series`.
 */
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

/**
 * 记录对象历史覆盖与缺失状态，供目录可用性显示。
 *
 * Describe object history coverage and missing-data state.
 */
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

/**
 * 说明目录对象可通过何种 SDK 方法访问。
 *
 * Describe SDK methods available for a catalog object.
 */
export type ResearchDataCatalogSdkAccessV1 =
  | { status: 'ready'; method: 'data.series' }
  | {
      status: 'not_ready';
      reason: 'source_available_but_local_data_missing';
    };

/**
 * 保留受治理清单的角色、币种和成员信息。
 *
 * Describe governed registry roles, currencies and membership.
 */
export interface ResearchDataCatalogRegistryV1 {
  exposureId: string;
  role: 'primary' | 'backup';
  region: string;
  currencyExposure: string;
  selectionAsOf: string;
  knownLimitations: readonly string[];
}

/**
 * 提供 SDK 方法签名、示例及双语列说明，供目录与补全同源展示。
 *
 * Describe SDK signatures, examples and bilingual columns for catalog and completion.
 */
export interface ResearchDataCatalogSdkMethodV1 {
  qualifiedName: string;
  name: string;
  descriptionZh: string;
  descriptionEn: string;
  signature: string;
  example: string;
  returnColumns: string[];
  returnColumnDetails: Array<{
    name: string;
    descriptionZh: string;
    descriptionEn: string;
  }>;
}

/**
 * 描述数据集日期、证券及行数覆盖。
 *
 * Describe dataset date, instrument and row coverage.
 */
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

/**
 * 共享公开数据集身份、方法与说明，供目录变体复用。
 *
 * Define shared dataset identity, method and guidance for catalog variants.
 */
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

/**
 * 定义本地已治理数据集，可插入为精确 SDK 调用。
 *
 * A governed, locally available dataset that can be inserted as an exact SDK call.
 */
export type ResearchDataCatalogDatasetV1 =
  | (ResearchDataCatalogDatasetBaseV1 & {
      method: 'data.cross_section' | 'data.panel';
      universe: string;
    })
  | (ResearchDataCatalogDatasetBaseV1 & {
      method: 'data.equity_financial_cross_section' | 'data.equity_financial_panel';
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
      method:
        | 'data.etf_shares'
        | 'data.index_valuation'
        | 'data.futures_settlement'
        | 'data.equity_financial_values'
        | 'data.equity_financial_statements'
        | 'data.equity_financial_metrics';
      identifier: string;
    });

/**
 * 引用当前用户已完成且可见的因子报告，供研究目录发现。
 *
 * A completed FactorReport owned by the current user and discoverable from Research.
 */
export interface ResearchDataCatalogFactorReportV1 {
  kind: 'factor_report';
  id: string;
  factor: string;
  factorName: string;
  analysisKind: FactorAnalysisKind;
  createdAt: string;
  computedAt: string | null;
}

/**
 * 引用当前用户已完成的回测报告，供研究目录发现。
 *
 * A completed BacktestReport owned by the current user and discoverable from Research.
 */
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

/**
 * 引用用户拥有的已完成不可变参数扫描。
 *
 * A completed immutable strategy parameter scan owned by the current user.
 */
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

/**
 * 同一响应供目录 UI 与 Monaco 标识、指标补全使用。
 *
 * One response powers the catalog UI and Monaco's identifier/measure completion.
 */
export interface ResearchDataCatalogResultV1 {
  version: 1;
  query: string;
  sdkMethods: ResearchDataCatalogSdkMethodV1[];
  instruments: ResearchDataCatalogInstrumentV1[];
  datasets: ResearchDataCatalogDatasetV1[];
  factorReports: ResearchDataCatalogFactorReportV1[];
  backtestReports: ResearchDataCatalogBacktestReportV1[];
  strategyScanReports: ResearchDataCatalogStrategyScanReportV1[];
  measures: ResearchMeasureDefinitionV1[];
}

/**
 * 记录研究数据或运行限制，供结果解释。
 *
 * Describe research data or execution limitations for interpretation.
 */
export interface ResearchDiagnosticV1 {
  code: string;
  severity: 'info' | 'warning' | 'error';
  messageZh: string;
  messageEn: string;
}

/**
 * 提供研究会话身份及轮次元数据。
 *
 * Describe research conversation identity and turn metadata.
 */
export interface ResearchConversationMeta {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 返回研究消息分页及会话状态，供恢复。
 *
 * Return research message pages and conversation state.
 */
export interface ResearchConversationMessages {
  messages: import('./chat.js').ChatMessage[];
  nextBefore?: number;
}

// —— Reactive research workbench ——

export type ResearchCellKindV1 = 'markdown' | 'python';
export type ResearchCellStatusV1 = 'idle' | 'running' | 'success' | 'error' | 'stale' | 'blocked';

/**
 * 描述 Cell 缺失、冲突或陈旧依赖，供阻塞解释。
 *
 * Describe missing, conflicting or stale cell dependencies.
 */
export interface ResearchCellDependencyIssueV1 {
  version: 1;
  reason: 'deleted_upstream_cell';
  sourceCellId: string;
  sourceCellPosition: number;
  sourceCellKind: ResearchCellKindV1;
  missingDefinitions: string[];
}
export type ResearchClarificationStatusV1 = 'pending' | 'answered' | 'superseded';
export type ResearchClarificationSelectionModeV1 = 'single' | 'multiple';
export type ResearchClarificationOptionKindV1 = 'concept' | 'binding' | 'keep_gap';
export type ResearchCellChangeProposalStatusV1 = 'pending' | 'applied' | 'rejected' | 'conflicted';
export type ResearchCellChangeReviewStatusV1 = 'open' | 'accepted' | 'reverted';
export type ResearchCellChangeAttemptStatusV1 = 'running' | 'success' | 'error' | 'cancelled';
export type ResearchCellChangeAttemptScopeV1 = 'affected' | 'clean_document';

/**
 * 绑定澄清候选与稳定目录引用，防止模糊替代。
 *
 * Associate clarification options with stable catalog references.
 */
export interface ResearchClarificationOptionV1 {
  id: string;
  kind: ResearchClarificationOptionKindV1;
  referenceId?: string;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}

/**
 * 定义澄清问题、选择方式和候选集合。
 *
 * Describe a clarification question, selection mode and allowed options.
 */
export interface ResearchClarificationQuestionV1 {
  id: string;
  prompt: string;
  selectionMode: ResearchClarificationSelectionModeV1;
  options: ResearchClarificationOptionV1[];
  allowCustom: boolean;
}

/**
 * 记录用户对某澄清问题确认的候选身份。
 *
 * Retain confirmed option identities for one clarification question.
 */
export interface ResearchClarificationSelectionV1 {
  questionId: string;
  selectedOptionIds: string[];
  customText?: string;
}

/**
 * 组合用户澄清选择，供恢复研究对话。
 *
 * Collect user clarification selections for conversation continuation.
 */
export interface ResearchClarificationAnswerV1 {
  selections: ResearchClarificationSelectionV1[];
  answeredAt: string;
}

/**
 * 持久化文档绑定的问题、答案与解决状态。
 *
 * Describe durable document-bound questions, answers and resolution state.
 */
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

/**
 * 共享提案 Cell 操作身份与预期修订。
 *
 * Define cell-operation identity and expected revision shared by proposals.
 */
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

/**
 * 区分 Cell 创建、更新、删除与排序，供提案应用。
 *
 * Discriminate proposed cell creation, update, deletion and reordering.
 */
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

/**
 * 返回提案无法应用的稳定原因及相关 Cell。
 *
 * Describe stable proposal conflicts and affected cells.
 */
export interface ResearchCellChangeConflictV1 {
  reason: ResearchCellChangeConflictReasonV1;
  cellIds: string[];
}

/**
 * 冻结 Agent 建议的操作、源码基线与状态，应用需明确用户动作。
 *
 * Retain proposed operations, source baseline and state for explicit application.
 */
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

/**
 * 保存审阅前后单 Cell 快照，供接受或撤销。
 *
 * Snapshot a cell before and after reviewable application.
 */
export interface ResearchCellChangeReviewCellV1 {
  cellId: string;
  cellKind: ResearchCellKindV1;
  position: number;
  kind: 'create' | 'update';
  beforeSource: string;
}

/**
 * 关联已应用变更、审阅状态和回退证据。
 *
 * Describe applied edits, review state and revert evidence.
 */
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

/**
 * 保存修改尝试中单 Cell 的执行与输出。
 *
 * Describe one cell's execution and output in a change attempt.
 */
export interface ResearchCellChangeAttemptCellV1 {
  executionId: string;
  cellId: string;
  position: number;
  kind: ResearchCellKindV1;
  revision: number;
  status: ResearchCellChangeAttemptStatusV1;
  outputHash?: string;
  outputTypes: ResearchCellOutputBlockV1['type'][];
  error?: string;
}

/**
 * 对比尝试的运行与输出变化，供效果审阅。
 *
 * Describe execution and output differences between attempts.
 */
export interface ResearchCellChangeAttemptComparisonV1 {
  version: 1;
  previousAttemptId: string;
  sourceChangedCellIds: string[];
  outputChangedCellIds: string[];
  statusChanged: boolean;
}

/**
 * 关联提案、范围、终态及不可变执行证据。
 *
 * Describe proposal attempt scope, state, revisions and outputs.
 */
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

/**
 * 限定 Cell 表格与参数可传输标量，供安全序列化。
 *
 * Constrain transferable cell scalars for safe serialization.
 */
export type ResearchCellScalarV1 = string | number | boolean | null;
export type ResearchChartKindV1 =
  | 'line'
  | 'bar'
  | 'scatter'
  | 'area'
  | 'stackedBar'
  | 'histogram'
  | 'combo'
  | 'boxplot'
  | 'heatmap'
  | 'event_path';

/**
 * 定义图表序列的标签和值，供通用研究渲染。
 *
 * Describe chart series labels and values for research rendering.
 */
export interface ResearchChartSeriesV1 {
  column: string;
  label?: string;
  type?: 'line' | 'bar';
  yAxis?: 'left' | 'right';
}

/**
 * 保留研究表格列、数据及截断信息，供结果解释。
 *
 * Describe table columns, rows and truncation metadata.
 */
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

/**
 * 将内联图表数据保留为执行产物，供历史结果读取。
 *
 * Inline chart data is retained as an execution artifact.
 */
export interface ResearchChartOutputV1 {
  type: 'chart';
  version: 1;
  title?: string;
  kind: ResearchChartKindV1;
  x: string;
  y?: string;
  series: ResearchChartSeriesV1[];
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

/**
 * 区分文本、表格、图表及图片输出，供统一渲染。
 *
 * Discriminate text, table, chart and image outputs for rendering.
 */
export type ResearchCellOutputBlockV1 =
  | { type: 'text'; text: string; level?: 'info' | 'warning' | 'error' }
  | { type: 'value'; value: ResearchCellScalarV1 | ResearchCellScalarV1[] }
  | ResearchTableOutputV1
  | ResearchChartOutputV1
  | ResearchImageOutputV1;

/**
 * 组合可编辑源码、修订、依赖与最近输出，供研究工作区。
 *
 * Describe editable source, revisions, dependencies and latest output in a research cell.
 */
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
  dependencyIssues: ResearchCellDependencyIssueV1[];
  outputs: ResearchCellOutputBlockV1[];
  lastExecutedRevision?: number;
  lastExecutedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 按广度优先顺序解析上游 Cell 提供者的传递闭包。
 *
 * Resolve transitive upstream Cell providers in breadth-first order.
 */
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

/**
 * 按文档顺序返回下游消费者的传递闭包。
 *
 * Resolve transitive downstream consumers in document order.
 */
export function researchDownstreamDependencyCellIds(
  cells: Array<{ id: string; definitions: string[]; references: string[] }>,
  rootCellIds: string[],
  seedDefinitions?: string[],
): string[] {
  const rootCellIdSet = new Set(rootCellIds);
  const pendingDefinitions = [
    ...(seedDefinitions ??
      cells.filter((cell) => rootCellIdSet.has(cell.id)).flatMap((cell) => cell.definitions)),
  ];
  const visitedDefinitions = new Set<string>();
  const downstreamCellIds = new Set<string>();

  while (pendingDefinitions.length > 0) {
    const definition = pendingDefinitions.shift()!;
    if (visitedDefinitions.has(definition)) {
      continue;
    }
    visitedDefinitions.add(definition);

    for (const cell of cells) {
      if (
        rootCellIdSet.has(cell.id) ||
        downstreamCellIds.has(cell.id) ||
        !cell.references.includes(definition)
      ) {
        continue;
      }
      downstreamCellIds.add(cell.id);
      pendingDefinitions.push(...cell.definitions);
    }
  }

  return cells.filter((cell) => downstreamCellIds.has(cell.id)).map((cell) => cell.id);
}

/**
 * 提供研究文档身份、时间与最近状态，供侧栏。
 *
 * Describe document identity, timing and recent state for navigation.
 */
export interface ResearchDocumentSummaryV1 extends ResearchConversationMeta {
  cellCount: number;
  staleCount: number;
  blockedCount: number;
  archivedAt: string | null;
}

export type ResearchDocumentListStateV1 = 'active' | 'archived';

/**
 * 返回文档内容、Cell、会话及运行信息，供工作区恢复。
 *
 * Return document content, cells, conversation and run state for workspace restoration.
 */
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

/**
 * 返回提案应用或拒绝后的状态与文档修订。
 *
 * Return proposal resolution state and resulting document revision.
 */
export interface ResearchCellChangeResolutionResultV1 {
  version: 1;
  outcome: 'applied' | 'rejected' | 'conflicted';
  proposal: ResearchCellChangeProposalV1;
  document: ResearchDocumentV1;
}

/**
 * 返回审阅接受或撤销后的 Cell 与提案状态。
 *
 * Return cells and proposal state after accepting or reverting review.
 */
export interface ResearchCellChangeReviewResolutionResultV1 {
  version: 1;
  outcome: 'accepted' | 'reverted' | 'conflicted';
  document: ResearchDocumentV1;
}

/**
 * 返回修改尝试的运行计划、结果与证据。
 *
 * Return a change attempt's plan, results and evidence.
 */
export interface ResearchCellChangeRunResultV1 {
  version: 1;
  attempt: ResearchCellChangeAttemptV1;
  document: ResearchDocumentV1;
}

/**
 * 记录依赖图冲突及涉及 Cell，供静态分析解释。
 *
 * Describe dependency conflicts and affected cells.
 */
export interface ResearchDependencyConflictV1 {
  name: string;
  cellIds: string[];
}

/**
 * 汇总文档依赖分析与冲突，供运行前校验。
 *
 * Collect document dependency analysis and conflicts before execution.
 */
export interface ResearchDocumentAnalysisV1 {
  version: 1;
  cells: Array<{ cellId: string; definitions: string[]; references: string[] }>;
  conflicts: ResearchDependencyConflictV1[];
}

/**
 * 汇总整文档执行的 Cell、终态与冻结证据。
 *
 * Describe current document-run cells and execution progress.
 */
export interface ResearchDocumentRunResultV1 {
  version: 1;
  document: ResearchDocumentV1;
  executedCellIds: string[];
  clean: boolean;
}

/**
 * 返回文档中断请求状态，供执行控制反馈。
 *
 * Describe document interruption state for execution controls.
 */
export interface ResearchDocumentInterruptResultV1 {
  version: 1;
  document: ResearchDocumentV1;
  interrupted: boolean;
}
