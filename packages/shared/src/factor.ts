import type { FactorBar as FactorSdkBar } from './sdk/factor/contract.js';
import type { SubmitFactorAnalysisRequest } from './api/factor.js';
import type { FactorResearchReportPayloadV1, FactorResearchSpecV1 } from './factor-research.js';
import type { FactorStatus } from './factor-dependency.js';

/**
 * 限定冻结因子分析使用的调仓频率。
 *
 * Factor-analysis wire types (product line 1.5 · factor research). Each analysis is a single-factor, monthly- or
 * weekly-rebalanced cross-sectional study over a date range — decile-sorted forward returns + Rank IC
 * + a long-short (top−bottom) leg. These are the shapes the API returns and the /factors page renders.
 */

export type FactorFreq = 'month' | 'week';

export type FactorLanguage = 'typescript' | 'python';
export type FactorRuntimeVersion = 'ts-v1' | 'py-v1';

export function factorRuntimeVersion(language: FactorLanguage): FactorRuntimeVersion {
  return language === 'python' ? 'py-v1' : 'ts-v1';
}

/**
 * 标识不可变研究运行所采用的评估协议。
 *
 * Evaluation protocol used by one immutable research run.
 */
export type FactorAnalysisKind = 'cross_sectional' | 'time_series' | 'panel' | 'macro_regime';

/**
 * 规定 IC 和分组前的截面中性化方式，保留规模与行业区别。
 *
 * Cross-sectional neutralization applied to factor values before IC / bucketing (3.4). 'none' = raw
 * values; 'size' = residual after regressing on log(total market cap); 'size_industry' = additionally
 * orthogonal to Shenwan level-1 industry (removes the "new factor is just a small-cap / sector bet"
 * illusion). A different neutralization is a different report (it's part of the cache key).
 */
export type Neutral = 'none' | 'size' | 'size_industry';

/**
 * 规定分位收益等权或市值加权口径。
 *
 * Quantile-return weighting scheme (modeled on JoinQuant's weight_method): equal-weight = signal
 * strength (small-cap bias); market-cap-weight = tradability / capacity.
 */
export type FactorWeight = 'equal' | 'mktcap';

/**
 * 表示分位组与前瞻期的日度归一化平均收益。
 *
 * One row of quantile × forward horizon (daily-normalized) — each quantile's average daily forward
 * return at a given horizon, computed for both weighting schemes.
 */
export interface QuantileHorizon {
  horizonDays: number; // forward horizon (trading days): 1 / 5 / 10 / 20 / 60
  equal: number[]; // length 10 (deciles), daily-normalized average return (equal-weight)
  mktcap: number[]; // market-cap-weight
}

/**
 * 区分因子数值来源，决定计算路径及目录标签。
 *
 * How a factor's values are sourced — drives the compute path (and shown as a tag in the UI).
 * 'custom' = user-authored (defineFactor); its compute runs cross-sectionally over a FactorBar.
 */
export type FactorKind =
  | 'price'
  | 'fundamental'
  | 'moneyflow'
  | 'rates'
  | 'commodity'
  | 'macro'
  | 'custom'
  | 'composite';

/**
 * 承载宿主构造的可变市场行，供公开只读因子行情映射。
 *
 * Mutable host data assembled for the public, readonly Factor authoring bar.
 */
export type FactorBar = { -readonly [Field in keyof FactorSdkBar]: FactorSdkBar[Field] };

/**
 * 提供因子目录身份，不携带完整分析结果。
 *
 * Catalog entry — one row in the factor list (no analysis, just identity).
 */
export interface FactorMeta {
  key: string; // preset = stable slug (mom / ep / mf_net_main …); custom = the Factor row's ULID
  label: string; // Chinese
  description?: string; // optional catalog summary; surfaced by strategy-editor factor hovers when present
  strategyKey?: string; // immutable Factor.key; absent for drafts and archived factors
  factorKey?: string; // immutable user-facing key even while a draft is not strategy-referencable
  status?: FactorStatus;
  approvedReportId?: string | null;
  kind: FactorKind;
  builtin?: boolean; // true = preset (a read-only code row in the library, can be copied into a custom factor)
  expectedDirection?: Exclude<FactorExpectedDirection, 'unknown'>;
  analysisKind?: FactorAnalysisKind;
  language?: FactorLanguage;
  runtimeVersion?: FactorRuntimeVersion;
  targetAssetClasses?: Array<'equity' | 'fixed_income' | 'commodity'>;
  /** Research-template capability, distinct from a strategy's tradable universe. */
  allowedAssets?: string[];
  /** Initial research selection; an immutable report still restores its own frozen assets. */
  defaultAssets?: string[];
  /** Localized explanations for visible but unsupported research assets. */
  unavailableAssetReasons?: Record<string, string>;
  composite?: FactorCompositeDefinition;
}

/**
 * 记录单分位组前瞻收益，0 为最低因子值组、9 为最高组。
 *
 * One decile bucket's forward-return stats (bucket 0 = lowest factor value … 9 = highest).
 */
export interface BucketStat {
  bucket: number;
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  navEnd: number;
}

/**
 * 记录最高组减最低组的假设市场中性收益。
 *
 * The long-short leg (top decile − bottom decile), as a hypothetical market-neutral return stream.
 */
export interface LongShortStat {
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  navEnd: number;
}

/**
 * 保留多空腿毛收益与费后净值，首日期作为净值起点。
 *
 * The long-short leg's NAV over time, gross vs net-of-cost (equal-weight). `dates[0]` is the first
 * formation date (NAV starts at 1 there); each later date is a period-end. gross/net are 1 longer than
 * the number of periods (the leading 1). Drives the gross-vs-net NAV line chart (net-of-cost view).
 */
export interface LongShortNav {
  dates: string[]; // YYYYMMDD, length = periods + 1
  gross: number[]; // cumulative NAV before trading cost
  net: number[]; // cumulative NAV after per-rebalance trading cost (turnover × round-trip)
}

/**
 * 描述已实现调仓期，形成日观测与实际前瞻收益区间分别保留。
 *
 * One realized rebalance period. The formation cross-section is observed on `formationDate`, and
 * returns are measured through `periodEndDate`. This compact series supports offline factor
 * monitoring without persisting per-stock factor values.
 */
export interface FactorPeriodObservation {
  formationDate: string;
  periodEndDate: string;
  rankIc: number;
  topReturn: number;
  bottomReturn: number;
  longShortGrossReturn: number;
  longShortNetReturn: number;
  topTurnover: number | null;
  sampleSize: number;
  sampleCoverage: number;
}

/**
 * 对有序期序列均值保存 HAC 推断，估计值保持原收益单位。
 *
 * HAC inference for the mean of one ordered period series. Estimates remain in the series' native
 * units: Rank IC for `rankIc`, period return for long-short, and standardized cross-sectional return
 * exposure for Fama–MacBeth.
 */
export interface FactorNeweyWestEstimateV1 {
  estimate: number;
  standardError: number;
  tStatistic: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
  observations: number;
  lag: number;
}

export type FactorFamaMacbethControlV1 = 'size' | 'value' | 'momentum' | 'quality';

export type FactorFamaMacbethUnavailableReasonV1 = 'insufficient_periods' | 'collinear_exposure';

/**
 * 汇总逐期截面回归的第二步推断，控制变量是辅助证据。
 *
 * Second-pass summary of per-period cross-sectional regressions. The controls are deliberately
 * fixed and versioned instead of being user-selectable, so reports remain directly comparable.
 */
export interface FactorFamaMacbethReportV1 {
  status: 'available' | 'unavailable';
  controlSet: 'cn_equity_style_v1';
  controls: FactorFamaMacbethControlV1[];
  standardization: 'population_zscore';
  periodsConsidered: number;
  periodsEstimated: number;
  averageObservations: number;
  candidateCoefficient?: FactorNeweyWestEstimateV1;
  unavailableReason?: FactorFamaMacbethUnavailableReasonV1;
}

/**
 * 附加范围明确的稳健推断，不替换主指标或发布门槛。
 *
 * Robust inference attached to scope-aware cross-sectional reports. This is evidence-only: it does
 * not rewrite the frozen publication criterion or the primary IC / decile return series.
 */
export interface FactorRobustInferenceV1 {
  version: 1;
  standardError: 'newey_west';
  confidenceLevel: 0.95;
  rankIc?: FactorNeweyWestEstimateV1;
  longShort: {
    equalGross?: FactorNeweyWestEstimateV1;
    equalNet?: FactorNeweyWestEstimateV1;
    mktcapGross?: FactorNeweyWestEstimateV1;
    mktcapNet?: FactorNeweyWestEstimateV1;
  };
  famaMacbeth: FactorFamaMacbethReportV1;
}

/**
 * 保存某 N 交易日前瞻收益的 Rank IC，供衰减曲线。
 *
 * Rank IC measured against the N-trading-day-forward return — one point on the IC-decay curve.
 */
export interface IcDecayPoint {
  horizonDays: number; // forward horizon in trading days (1 / 5 / 10 / 20 / 60)
  icMean: number;
  icir: number; // icMean / icStd across periods
}

export type FactorDiagnosticDimension = 'industry' | 'size_bucket' | 'liquidity_bucket';

/**
 * 仅用于稳健性诊断的样本切片，不改变主报告与发布标准。
 *
 * Robustness-only slice. It never changes the primary report metrics or publication criterion.
 */
export interface FactorDiagnosticSlice {
  dimension: FactorDiagnosticDimension;
  key: string;
  periods: number;
  observations: number;
  rankIcMean: number;
  rankIcirAnnual: number;
  rankIcPositiveRate: number;
}

/**
 * 封装固定频率、起止日期上的单因子分析结果。
 *
 * A single-factor analysis report over one (freq, start, end) window.
 */
export interface FactorReport {
  factor: string; // unique key
  label: string; // human label (Chinese)
  freq: FactorFreq; // rebalance / forward-return frequency
  neutral?: Neutral; // cross-sectional neutralization applied (absent on old cached reports = 'none')
  start: string; // YYYYMMDD (inclusive)
  end: string; // YYYYMMDD (inclusive)
  periods: number; // number of rebalance periods in the sample (months or weeks)
  icMean: number; // Rank IC mean — sign reveals direction (>0 momentum-like, <0 reversal-like)
  icStd: number;
  icir: number; // icMean / icStd (single-period)
  icirAnnual: number; // icir × √(periodsPerYear)
  icPosRate: number; // fraction of periods with IC > 0
  buckets: BucketStat[]; // length 10 (deciles), ascending by factor value — equal-weight
  longShort: LongShortStat; // equal-weight long-short
  topTurnover: number; // average one-way turnover of the top decile (rebalance churn)
  icDecay: IcDecayPoint[]; // Rank IC at several forward horizons — the decay curve (holding period)
  // —— weighting scheme + quantile × forward horizon (optional: old cached reports lack these) ——
  bucketsMktcap?: BucketStat[]; // market-cap-weighted quantile stats (used when the UI toggles "weighting"; buckets is equal-weight)
  longShortMktcap?: LongShortStat; // market-cap-weighted long-short
  quantileHorizons?: QuantileHorizon[]; // quantile × forward-horizon heatmap (daily-normalized, both weightings)
  // —— net-of-cost view (3.4): the long-short after per-rebalance trading cost (turnover × round-trip) ——
  longShortNet?: LongShortStat; // equal-weight long-short, net of trading cost
  longShortNetMktcap?: LongShortStat; // market-cap-weight long-short, net of trading cost
  lsNav?: LongShortNav; // equal-weight long-short NAV, gross vs net (the net-of-cost line chart)
  periodObservations?: FactorPeriodObservation[];
  diagnostics?: FactorDiagnosticSlice[];
  robustInference?: FactorRobustInferenceV1;
  methodology?: FactorMethodologyAudit;
}

/**
 * 保存跨调仓日平均的共同样本 Spearman 因子相关性。
 *
 * A factor-correlation report: mean cross-sectional Spearman (Rank IC-style) between each pair of the
 * selected factors, averaged over the rebalance dates. `keys`/`labels` include a fixed trailing pseudo-
 * factor 'size' (log total market cap) so every factor's entanglement with size is always visible. The
 * matrix is symmetric with 1 on the diagonal; cells are null when a pair never had enough overlap.
 */
export interface FactorCorrelation {
  keys: string[]; // factor keys in matrix order, last = 'size' (the log-market-cap pseudo-factor)
  labels: string[]; // display labels, parallel to keys
  freq: FactorFreq;
  start: string;
  end: string;
  periods: number; // rebalance dates that contributed (min across pairs)
  matrix: (number | null)[][]; // NxN symmetric, mean per-date Spearman; null = insufficient overlap
}

/**
 * 冻结创建分析报告时规范化的版本输入。
 *
 * Versioned, normalized inputs frozen when a factor-analysis report is created.
 */
export interface FactorAnalysisSpecV1 {
  version: 1;
  freq: FactorFreq;
  start: string;
  end: string;
  neutral: Neutral;
}

export type FactorOutlierMethod = 'none' | 'winsor' | 'mad';

/**
 * 冻结截尾或其他异常值处理及参数。
 *
 * Freeze outlier preprocessing and its parameters.
 */
export interface FactorOutlierSpecV1 {
  method: FactorOutlierMethod;
  tailFraction: number;
  madThreshold: number;
}

/**
 * 为分析输入增加版本化研究处理设置，供历史兼容。
 *
 * Version analysis preprocessing inputs for report compatibility.
 */
export interface FactorAnalysisSpecV2 {
  version: 2;
  freq: FactorFreq;
  start: string;
  end: string;
  neutral: Neutral;
  universe: {
    minimumListingDays: number;
    liquidityDropFraction: number;
    minimumCandidates: number;
  };
  missing: {
    minimumWindowCoverage: number;
  };
  outliers: {
    factorExposure: FactorOutlierSpecV1;
    forwardReturn: FactorOutlierSpecV1;
  };
  costs: {
    commissionPerSide: number;
    stampDutySellSide: number;
    slippagePerSide: number;
  };
}

/**
 * 保存对应版本的分析与组合输入，供冻结报告复现。
 *
 * Retain versioned analysis and composition inputs for reproducibility.
 */
export interface FactorAnalysisSpecV3 extends Omit<FactorAnalysisSpecV2, 'version' | 'universe'> {
  version: 3;
  universe: FactorAnalysisSpecV2['universe'] & {
    excludeRiskWarnings: boolean;
    excludePendingDelisting: boolean;
  };
}

export type FactorCompositeStandardization = 'rank' | 'zscore';
export type FactorCompositeDirection = 'positive' | 'negative';

/**
 * 冻结组合组件、方向、权重和标准化方式。
 *
 * Freeze composite components, directions, weights and standardization.
 */
export interface FactorCompositeDefinitionV1 {
  version: 1;
  name: string;
  standardization: FactorCompositeStandardization;
  weighting: 'equal';
  components: Array<{
    factor: string;
    direction: FactorCompositeDirection;
  }>;
}

/**
 * 定义跨资产 Panel 组合，组件由因子目录解析并冻结。
 *
 * Cross-asset panel composite. Components are resolved against the factor catalog and frozen with
 * their executable sources in every report, while this reusable definition keeps stable identities.
 */
export interface FactorPanelCompositeDefinitionV2 {
  version: 2;
  key: string;
  name: string;
  analysisKind: 'panel';
  standardization: FactorCompositeStandardization;
  weighting: 'equal';
  components: Array<{
    factor: string;
    direction: FactorCompositeDirection;
  }>;
}

/**
 * 区分不同研究协议的组合定义，供计算分派。
 *
 * Discriminate protocol-specific composite definitions for evaluation.
 */
export type FactorCompositeDefinition =
  | FactorCompositeDefinitionV1
  | FactorPanelCompositeDefinitionV2;

/**
 * 组合公开组合身份、定义与状态，供目录和编辑器。
 *
 * Describe composite identity, definition and state for catalogs and editors.
 */
export interface FactorCompositeResource {
  id: string;
  key?: string | null;
  name: string;
  definition: FactorCompositeDefinition;
  status?: FactorStatus;
  approvedReportId?: string | null;
  codeHash?: string | null;
  publishedAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 保留该版本冻结分析规格，供历史报告读取。
 *
 * Retain versioned frozen analysis settings for historical reports.
 */
export interface FactorAnalysisSpecV4 extends Omit<FactorAnalysisSpecV3, 'version'> {
  version: 4;
  composite: FactorCompositeDefinitionV1;
}

export type FactorEquityIndexCode = '000300.SH' | '000905.SH' | '000852.SH';

/**
 * 冻结全市场或时点指数证券池及组内排名规则。
 *
 * Freeze global or dated index universes and within-group ranking rules.
 */
export interface FactorEvaluationScopeV1 {
  version: 1;
  universe:
    | { kind: 'market'; market: 'cn_a' }
    | { kind: 'index'; indexCode: FactorEquityIndexCode };
  membership: 'point_in_time';
  rankingScope: 'global' | 'within_industry';
  diagnostics: Array<'industry' | 'size_bucket' | 'liquidity_bucket'>;
}

/**
 * 首次显式冻结评估证券范围，不从当前成员推断历史。
 *
 * First scope-aware cross-sectional spec. EvaluationScope V1 freezes global or point-in-time SW L1
 * within-industry ranking. Diagnostic choices remain part of report identity as they are enabled.
 */
export interface FactorAnalysisSpecV5 extends Omit<FactorAnalysisSpecV3, 'version'> {
  version: 5;
  evaluationScope: FactorEvaluationScopeV1;
}

/**
 * 冻结截面稳健推断的样本、控制和滞后设置。
 *
 * Freeze sample, control and lag settings for robust cross-sectional inference.
 */
export interface FactorCrossSectionalInferenceSpecV1 {
  version: 1;
  standardError: 'newey_west';
  lag: 'automatic';
  confidenceLevel: 0.95;
  famaMacbeth: {
    controlSet: 'cn_equity_style_v1';
    standardization: 'population_zscore';
    minimumPeriods: 12;
    minimumObservationsPerPeriod: 100;
    momentumLookbackTradingDays: 252;
    momentumSkipTradingDays: 21;
  };
}

/**
 * 在 V5 主样本和指标不变的基础上增加稳健推断。
 *
 * Cross-sectional V6 adds robust inference without changing V5's primary analysis population.
 * Composite is optional because single and composite factors now share one current protocol.
 */
export interface FactorAnalysisSpecV6 extends Omit<FactorAnalysisSpecV3, 'version'> {
  version: 6;
  evaluationScope: FactorEvaluationScopeV1;
  inference: FactorCrossSectionalInferenceSpecV1;
  composite?: FactorCompositeDefinitionV1;
}

/**
 * 统一历史版本的分析规格，供兼容读取与冻结执行。
 *
 * Unify versioned analysis specifications for compatible reads and execution.
 */
export type FactorAnalysisSpec =
  | FactorAnalysisSpecV1
  | FactorAnalysisSpecV2
  | FactorAnalysisSpecV3
  | FactorAnalysisSpecV4
  | FactorAnalysisSpecV5
  | FactorAnalysisSpecV6;

export type FactorSampleStageKey =
  | 'factor_value'
  | 'formation_and_forward_quote'
  | 'evaluation_universe'
  | 'ranking_scope'
  | 'listing_age'
  | 'risk_warning'
  | 'pending_delisting'
  | 'liquidity';

/**
 * 记录一个采样阶段的保留与剔除数量。
 *
 * Record retained and excluded samples at one analysis stage.
 */
export interface FactorSampleStageAudit {
  key: FactorSampleStageKey;
  before: number;
  after: number;
}

/**
 * 核验研究窗口所需价格和辅助数据覆盖。
 *
 * Describe required price and auxiliary coverage within a research window.
 */
export interface FactorWindowCoverageAudit {
  declaredWindowDays: number;
  minimumCoverage: number;
  meanCoverage: number;
  observations: number;
  droppedForCoverage: number;
}

/**
 * 保留组内排名范围和样本诊断。
 *
 * Retain ranking scope and sample diagnostics.
 */
export type FactorRankingAudit =
  | { kind: 'global' }
  | {
      kind: 'within_industry_percentile';
      classification: 'sw_l1';
      minimumGroupSize: 5;
      missingClassification: number;
      undersizedGroup: number;
      groupsEvaluated: number;
    };

/**
 * 组合采样、覆盖和处理证据，解释报告方法。
 *
 * Collect sampling, coverage and preprocessing evidence for methodology review.
 */
export interface FactorMethodologyAudit {
  specVersion: 1 | 2 | 3 | 4 | 5 | 6;
  evaluationScope?: FactorEvaluationScopeV1;
  ranking?: FactorRankingAudit;
  dataCutoff: string;
  periodsConsidered: number;
  periodsAnalyzed: number;
  stages: FactorSampleStageAudit[];
  windowCoverage?: FactorWindowCoverageAudit;
  unavailableHistoricalFilters: Array<
    'risk_warning' | 'pending_delisting' | 'negative_equity' | 'long_suspension'
  >;
}

export type FactorReportStatus = 'running' | 'done' | 'error' | 'stale';
export type FactorExpectedDirection = 'positive' | 'negative' | 'unknown';
/**
 * 提供报告身份、范围和状态摘要，供历史列表。
 *
 * Describe report identity, scope and state for history lists.
 */
export interface FactorReportSummary {
  id: string;
  factor: string;
  analysisKind: FactorAnalysisKind;
  status: FactorReportStatus;
  language?: FactorLanguage;
  runtimeVersion?: FactorRuntimeVersion;
  /** Legacy cross-sectional protocol. New analysis kinds use researchSpec only. */
  spec?: FactorAnalysisSpec;
  researchSpec: FactorResearchSpecV1;
  variantKey?: string;
  jobId?: string;
  createdAt: string;
  computedAt?: string;
  error?: string;
  metrics?: {
    ic?: number;
    rankIc?: number;
    medianNeweyWestT?: number;
    meanDirectionHitRate?: number;
    panelRankIcMean?: number;
    panelNetLongShortAnnualized?: number;
  };
}

/**
 * 返回可见冻结报告的规格、结果与方法证据。
 *
 * Return a visible frozen report's specification, results and methodology evidence.
 */
export interface FactorReportDetail extends FactorReportSummary {
  payload?: FactorReport;
  researchPayload?: FactorResearchReportPayloadV1;
  factorCodeSnapshot?: string;
  factorCodeHash?: string;
  dataRevision?: string;
}

/**
 * 组合因子报告分页列表与状态信息。
 *
 * Collect paginated factor reports and state metadata.
 */
export interface FactorReportListResponse {
  items: FactorReportSummary[];
}

export type RunFactorAnalysisRequest = SubmitFactorAnalysisRequest;

/**
 * 返回分析入队后的报告与 Job 身份。
 *
 * Return report and job identities after evaluation enqueueing.
 */
export interface RunFactorAnalysisResponse {
  reportId: string;
  jobId: string;
  status: 'running';
  reusedRunning: boolean;
}
