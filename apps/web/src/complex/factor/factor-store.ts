import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  textMessage,
  type ChatMessage,
  type FactorMeta,
  type FactorReport,
  type FactorReportDetail,
  type FactorReportListResponse,
  type FactorReportSummary,
  type FactorAnalysisSpec,
  type FactorAnalysisKind,
  type FactorLanguage,
  type FactorAnalysisSpecV3,
  type FactorAnalysisSpecV6,
  type FactorEvaluationScopeV1,
  type FactorEquityIndexCode,
  type FactorCompositeDefinition,
  type FactorCompositeResource,
  type FactorFreq,
  type FactorCorrelation,
  type FactorResearchIntentV1,
  type FactorResearchSummary,
  type FactorStatus,
  type PublishedFactor,
  type FactorHoldoutPolicyV1,
  type FactorResearchSpecV1,
  type ResearchFactorHandoffV1,
  type FactorTimeSeriesReportV1,
  type FactorPanelReportV1,
  type FactorMacroRegimeReportV1,
  type MacroRegimeFactorResearchSpecV1,
  type PanelFactorResearchSpecV1,
  type TimeSeriesFactorResearchSpecV1,
  type Neutral,
  type LogLine,
} from '@jixie/shared';
import i18n from '@src/i18n';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import {
  getFactorCatalog,
  getFactorReports,
  getFactorReport,
  runFactorAnalysis,
  pollFactorJob,
  getCustomFactor,
  createFactor,
  updateFactor,
  deleteCustomFactor,
  copyFactor,
  sendFactorAgent,
  factorQa,
  refreshFactorMetadata,
  runFactorCorrelation,
  getFactorCorrelation,
  findCorrelationRunningJob,
  getFactorResearchSummary,
  getFactorResearchWindow,
  runFactorHoldout,
  revealFactorHoldout,
  createFactorComposite,
  updateFactorComposite,
  deleteFactorComposite,
  copyFactorComposite,
  publishFactor,
  archiveFactor,
  publishFactorComposite,
  archiveFactorComposite,
} from '@src/api/client';
import { panelAssetsFor } from './panel-universe';
import {
  allowedTimeSeriesAssetsFor,
  defaultTimeSeriesAssetsFor,
  isTimeSeriesAsset,
  TIME_SERIES_ASSETS,
  type TimeSeriesAsset,
} from './time-series-assets';

// Initial state from the URL. A stable report id restores both the result and its frozen parameters.
type FactorSetupParams = {
  factor?: string;
  report?: string;
};

const DEFAULT_START = '20150101';
const DEFAULT_END = '20261231';
const POLL_INTERVAL_MS = 800;
export const MACRO_REGIME_ASSETS: TimeSeriesAsset[] = [
  '510300.SH',
  '511010.SH',
  '518880.SH',
  '159985.SZ',
];
type MacroRevisionPolicy = MacroRegimeFactorResearchSpecV1['dataPolicy']['revisionPolicy'];
type FactorUniverseChoice = 'cn_a' | FactorEquityIndexCode;

type SourceResearchExecution = {
  id: string;
  documentId: string;
  title: string;
  displayName: string | null;
  sequence: number;
  promotedAt: string | null;
};

type FactorMethodologyParams = Pick<
  FactorAnalysisSpecV3,
  'universe' | 'missing' | 'outliers' | 'costs'
>;

const DEFAULT_METHODOLOGY: FactorMethodologyParams = {
  universe: {
    minimumListingDays: 365,
    liquidityDropFraction: 0.25,
    minimumCandidates: 100,
    excludeRiskWarnings: true,
    excludePendingDelisting: true,
  },
  missing: { minimumWindowCoverage: 2 / 3 },
  outliers: {
    factorExposure: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
    forwardReturn: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
  },
  costs: {
    commissionPerSide: 0.00025,
    stampDutySellSide: 0.0005,
    slippagePerSide: 0.001,
  },
};

function defaultMethodology(): FactorMethodologyParams {
  return structuredClone(DEFAULT_METHODOLOGY);
}

function defaultEvaluationScope(): FactorEvaluationScopeV1 {
  return {
    version: 1,
    universe: { kind: 'market', market: 'cn_a' },
    membership: 'point_in_time',
    rankingScope: 'global',
    diagnostics: [],
  };
}

const DEFAULT_CROSS_SECTIONAL_INFERENCE: FactorAnalysisSpecV6['inference'] = {
  version: 1,
  standardError: 'newey_west',
  lag: 'automatic',
  confidenceLevel: 0.95,
  famaMacbeth: {
    controlSet: 'cn_equity_style_v1',
    standardization: 'population_zscore',
    minimumPeriods: 12,
    minimumObservationsPerPeriod: 100,
    momentumLookbackTradingDays: 252,
    momentumSkipTradingDays: 21,
  },
};

// Starter skeleton for a brand-new custom factor (what the middle editor shows before the Agent writes).
export const DEFAULT_FACTOR_CODE = `# 用左侧 Agent 描述你想要的因子，AI 会生成 Python；也可以直接修改。
from jixie import Factor, FactorBar, CrossSectionalFactorContext

factor = Factor.cross_sectional(name="新因子")

@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    return 1 / bar.pe_ttm if bar.pe_ttm is not None and bar.pe_ttm > 0 else None
`;

export const DEFAULT_TIME_SERIES_FACTOR_CODE = `# ETF 时间序列信号：默认使用 Python Factor SDK。
from jixie import Factor, AssetFactorContext

factor = Factor.time_series(
    name="ETF 20日趋势",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity", "fixed_income", "commodity"],
    window=21,
)

@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    current = ctx.value("etf.adjustedClose")
    previous = ctx.lag("etf.adjustedClose", 20)
    return current / previous - 1 if current is not None and previous is not None and previous > 0 else None
`;

export const DEFAULT_PANEL_FACTOR_CODE = `# 跨资产 Panel 信号：每个决策日输出一个可横向比较的分数。
from jixie import Factor, AssetFactorContext

factor = Factor.panel(
    name="跨资产120日动量",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity", "fixed_income", "commodity"],
    window=121,
)

@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    current = ctx.value("etf.adjustedClose")
    previous = ctx.lag("etf.adjustedClose", 120)
    return current / previous - 1 if current is not None and previous is not None and previous > 0 else None
`;

type EditableFactorAnalysisKind = Extract<
  FactorAnalysisKind,
  'cross_sectional' | 'time_series' | 'panel'
>;

/**
 * Factor research store — Agent-authored, IDE-style (mirrors the strategy workbench). Two kinds of factor:
 *  - preset (mom/ep/dv/…): a built-in formula → just pick it and run analysis; no code, no chat;
 *  - custom: a draft row is created up front with an immutable key; Agent and editor changes autosave,
 *    while publishing locks its name, code, research type, and approved report.
 * Each explicit analysis run creates an immutable report; only an identical in-flight variant is reused.
 */
export class FactorStore extends BaseStore<FactorSetupParams> {
  public catalogLoader = new LoaderModel<FactorMeta[]>();
  public reportLoader = new LoaderModel<FactorReportDetail>();
  public reportsLoader = new LoaderModel<FactorReportListResponse>();
  public saveLoader = new LoaderModel<{ id: string; name: string }>();
  public analysisPoller = new PollingModel();
  public researchSummaryLoader = new LoaderModel<FactorResearchSummary>();
  public researchWindowLoader = new LoaderModel<FactorHoldoutPolicyV1>();
  public publishLoader = new LoaderModel<PublishedFactor>();
  public archiveLoader = new LoaderModel<PublishedFactor>();

  public selectedKey = ''; // preset key OR custom factor id — the analysis target
  public selectedReportId = '';
  public mode: 'preset' | 'custom' | 'composite' | 'time_series' | 'panel' | 'macro_regime' =
    'preset';
  public definitionAnalysisKind: EditableFactorAnalysisKind = 'cross_sectional';
  public targetAssetClasses: FactorMeta['targetAssetClasses'] = undefined;
  public language: FactorLanguage = 'python';
  public compositeDefinition: FactorCompositeDefinition | null = null;
  public code = ''; // the custom factor's defineFactor source (empty for presets)
  public persistedCode = ''; // code as persisted in the DB — baseline for `edited`
  public pendingAgentCode: string | null = null; // Agent result held back when the user edited mid-turn
  public chatMessages: ChatMessage[] = []; // the Agent conversation for the current custom factor
  public turnStream = new AgentTurnStream(); // the in-flight turn's SSE mirror (pending bubble)
  public sending = false; // an Agent turn is in flight
  public nlText = ''; // the Agent chat draft
  public factorKey = ''; // immutable Factor.key used by strategies
  public factorStatus: FactorStatus = 'draft';
  public description = ''; // localized catalog summary generated from the current context
  public researchHandoff: ResearchFactorHandoffV1 | null = null;
  public sourceResearchExecution: SourceResearchExecution | null = null;

  public freq: FactorFreq = 'month';
  public neutral: Neutral = 'none'; // cross-sectional neutralization in the draft analysis spec
  public start = DEFAULT_START;
  public end = DEFAULT_END;
  public specVersion: 1 | 2 | 3 | 4 | 5 | 6 = 6;
  public evaluationScope = defaultEvaluationScope();
  public methodology = defaultMethodology();
  public timeSeriesAssets: TimeSeriesAsset[] = [...TIME_SERIES_ASSETS];
  public timeSeriesHorizon: 5 | 20 | 60 = 20;
  public macroRevisionPolicy: MacroRevisionPolicy = 'latest_vintage';
  public logs: LogLine[] = []; // streamed progress of the current run (job), tagged system/user
  public jobRunning = false; // a streamed analysis is in flight
  public queuePosition: number | null = null;

  private jobId: string | null = null;
  private pollingReportId: string | null = null;
  private since = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  // —— Correlation matrix (its own params: a factor multi-select over the shared freq/range) ——
  public correlationLoader = new LoaderModel<FactorCorrelation>();
  public correlationPoller = new PollingModel();
  public corrKeys: string[] = []; // 2–8 selected factor keys
  public corrLogs: LogLine[] = [];
  public corrRunning = false;
  private corrJobId: string | null = null;
  private corrSince = 0;

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      selectedKey: observable.ref,
      selectedReportId: observable.ref,
      mode: observable.ref,
      definitionAnalysisKind: observable.ref,
      targetAssetClasses: observable.ref,
      language: observable.ref,
      compositeDefinition: observable.ref,
      code: observable.ref,
      persistedCode: observable.ref,
      pendingAgentCode: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      nlText: observable.ref,
      factorKey: observable.ref,
      factorStatus: observable.ref,
      description: observable.ref,
      researchHandoff: observable.ref,
      sourceResearchExecution: observable.ref,
      freq: observable.ref,
      neutral: observable.ref,
      start: observable.ref,
      end: observable.ref,
      specVersion: observable.ref,
      evaluationScope: observable.ref,
      methodology: observable.ref,
      timeSeriesAssets: observable.ref,
      timeSeriesHorizon: observable.ref,
      macroRevisionPolicy: observable.ref,
      logs: observable.ref,
      jobRunning: observable.ref,
      queuePosition: observable.ref,
      corrKeys: observable.ref,
      corrLogs: observable.ref,
      corrRunning: observable.ref,
      selected: computed,
      report: computed,
      timeSeriesReport: computed,
      panelReport: computed,
      macroRegimeReport: computed,
      isTimeSeries: computed,
      isPanel: computed,
      isMacroRegime: computed,
      timeSeriesAllowedAssets: computed,
      reportDetail: computed,
      correlation: computed,
      paramsModified: computed,
      analysisSpec: computed,
      researchSpec: computed,
      panelAssets: computed,
      evaluationUniverse: computed,
      codeModifiedSinceReport: computed,
      reportOutdated: computed,
      hasDraftChanges: computed,
      edited: computed,
      qaMode: computed,
      setFreq: action,
      setNeutral: action,
      setStart: action,
      setEnd: action,
      setUniverseParameter: action,
      setEvaluationUniverse: action,
      setEvaluationRankingScope: action,
      toggleEvaluationDiagnostic: action,
      setMinimumWindowCoverage: action,
      setOutlierMethod: action,
      setCostParameter: action,
      setTimeSeriesAssets: action,
      setTimeSeriesHorizon: action,
      setMacroRevisionPolicy: action,
      setCorrKeys: action,
    });
  }

  public setup(params: FactorSetupParams) {
    super.setup(params);
    this.catalogLoader.setup({ request: () => getFactorCatalog() });
    this.reportsLoader.setup({ request: () => getFactorReports(this.selectedKey) });
    this.saveLoader.setup({
      request: (input: { id: string; code: string }) =>
        updateFactor(input.id, { code: input.code }),
    });
    this.reportLoader.setup({ request: (reportId: string) => getFactorReport(reportId) });
    this.analysisPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollOnce() });
    this.researchSummaryLoader.setup({
      request: () => getFactorResearchSummary(this.selectedKey || undefined),
    });
    this.researchWindowLoader.setup({ request: () => getFactorResearchWindow() });
    this.publishLoader.setup({
      request: (reportId: string) =>
        this.mode === 'composite'
          ? publishFactorComposite(this.selectedKey, reportId)
          : publishFactor(this.selectedKey, reportId),
    });
    this.archiveLoader.setup({
      request: () =>
        this.mode === 'composite'
          ? archiveFactorComposite(this.selectedKey)
          : archiveFactor(this.selectedKey),
    });
    this.correlationLoader.setup({
      request: () => getFactorCorrelation(this.corrKeys, this.freq, this.start, this.end),
    });
    this.correlationPoller.setup({
      interval: POLL_INTERVAL_MS,
      request: () => this.pollCorrelationOnce(),
    });
    this.registCleaner(() => this.catalogLoader.cleanup());
    this.registCleaner(() => this.reportsLoader.cleanup());
    this.registCleaner(() => this.saveLoader.cleanup());
    this.registCleaner(() => {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }
    });
    this.registCleaner(() => this.reportLoader.cleanup());
    this.registCleaner(() => this.analysisPoller.cleanup());
    this.registCleaner(() => this.researchSummaryLoader.cleanup());
    this.registCleaner(() => this.researchWindowLoader.cleanup());
    this.registCleaner(() => this.publishLoader.cleanup());
    this.registCleaner(() => this.archiveLoader.cleanup());
    this.registCleaner(() => this.correlationLoader.cleanup());
    this.registCleaner(() => this.correlationPoller.cleanup());
    this.registCleaner(() => this.turnStream.detach()); // drop the SSE subscription; the turn keeps running
    void this.catalogLoader.run();
    void this.researchWindowLoader.run().then((window) => {
      if (!this.selectedReportId && this.end === DEFAULT_END) {
        runInAction(() => (this.end = window.exploreEnd));
      }
    });
    void this.researchSummaryLoader.run();

    // Preselect synchronously so the first paint shows the workbench while detail/history load.
    if (params.factor) {
      runInAction(() => {
        this.selectedKey = params.factor!;
        this.selectedReportId = params.report ?? '';
      });
      void this.selectFactor(params.factor, params.report);
    }
  }

  public get selected(): FactorMeta | null {
    return this.catalogLoader.result?.find((f) => f.key === this.selectedKey) ?? null;
  }

  /** The current report only if it matches the selected factor (guards a stale render mid-switch). */
  public get report(): FactorReport | null {
    return this.reportDetail?.payload ?? null;
  }

  public get timeSeriesReport(): FactorTimeSeriesReportV1 | null {
    const payload = this.reportDetail?.researchPayload;
    return payload?.analysisKind === 'time_series' ? payload.report : null;
  }

  public get panelReport(): FactorPanelReportV1 | null {
    const payload = this.reportDetail?.researchPayload;
    return payload?.analysisKind === 'panel' ? payload.report : null;
  }

  public get macroRegimeReport(): FactorMacroRegimeReportV1 | null {
    const payload = this.reportDetail?.researchPayload;
    return payload?.analysisKind === 'macro_regime' ? payload.report : null;
  }

  public get isTimeSeries(): boolean {
    return (
      this.mode === 'time_series' ||
      (this.mode === 'custom' && this.definitionAnalysisKind === 'time_series')
    );
  }

  public get isPanel(): boolean {
    return (
      this.mode === 'panel' ||
      (this.mode === 'custom' && this.definitionAnalysisKind === 'panel') ||
      (this.mode === 'composite' && this.compositeDefinition?.version === 2)
    );
  }

  public get isMacroRegime(): boolean {
    return this.mode === 'macro_regime';
  }

  public get timeSeriesAllowedAssets(): TimeSeriesAsset[] {
    const selected = this.selected;
    return allowedTimeSeriesAssetsFor(
      selected
        ? {
            ...selected,
            targetAssetClasses: this.targetAssetClasses ?? selected.targetAssetClasses,
          }
        : undefined,
    );
  }

  public get panelAssets(): PanelFactorResearchSpecV1['assets'] {
    return panelAssetsFor(this.targetAssetClasses ?? this.selected?.targetAssetClasses);
  }

  public get reportDetail(): FactorReportDetail | null {
    const detail = this.reportLoader.result;
    return detail && detail.factor === this.selectedKey && detail.id === this.selectedReportId
      ? detail
      : null;
  }

  /** Draft parameters are independent from the selected immutable report. */
  public get paramsModified(): boolean {
    const detail = this.reportDetail;
    if (!detail) {
      return false;
    }
    if (
      detail.analysisKind === 'time_series' ||
      detail.analysisKind === 'panel' ||
      detail.analysisKind === 'macro_regime'
    ) {
      const frozen = detail.researchSpec;
      if (frozen.analysisKind !== detail.analysisKind) {
        return true;
      }
      return (
        JSON.stringify(assetResearchDraftIdentity(frozen)) !== JSON.stringify(this.researchSpec)
      );
    }
    return !!detail.spec && JSON.stringify(detail.spec) !== JSON.stringify(this.analysisSpec);
  }

  public get analysisSpec(): FactorAnalysisSpec {
    const common = {
      freq: this.freq,
      start: this.start,
      end: this.end,
      neutral: this.neutral,
    };
    if (this.specVersion === 1) {
      return { version: 1, ...common };
    }
    if (this.specVersion === 2) {
      return {
        version: 2,
        ...common,
        universe: {
          minimumListingDays: this.methodology.universe.minimumListingDays,
          liquidityDropFraction: this.methodology.universe.liquidityDropFraction,
          minimumCandidates: this.methodology.universe.minimumCandidates,
        },
        missing: this.methodology.missing,
        outliers: this.methodology.outliers,
        costs: this.methodology.costs,
      };
    }
    if (this.specVersion === 4 && this.compositeDefinition?.version === 1) {
      return {
        version: 4,
        ...common,
        ...this.methodology,
        composite: structuredClone(this.compositeDefinition),
      };
    }
    if (this.specVersion === 5) {
      return {
        version: 5,
        ...common,
        ...this.methodology,
        evaluationScope: structuredClone(this.evaluationScope),
      };
    }
    if (this.specVersion === 6) {
      return {
        version: 6,
        ...common,
        ...this.methodology,
        evaluationScope: structuredClone(this.evaluationScope),
        inference: structuredClone(DEFAULT_CROSS_SECTIONAL_INFERENCE),
        ...(this.mode === 'composite' && this.compositeDefinition?.version === 1
          ? { composite: structuredClone(this.compositeDefinition) }
          : {}),
      };
    }
    return { version: 3, ...common, ...this.methodology };
  }

  public get researchSpec(): FactorResearchSpecV1 {
    if (this.isMacroRegime) {
      return {
        version: 1,
        analysisKind: 'macro_regime',
        start: this.start,
        end: this.end,
        observationFrequency: 'monthly',
        targetAssets: [...this.timeSeriesAssets],
        target: {
          kind: 'forward_total_return',
          horizon: this.timeSeriesHorizon,
          horizonUnit: 'trade_day',
        },
        dataPolicy: {
          pointInTime: true,
          revisionPolicy: this.macroRevisionPolicy,
          dataCutoff: null,
        },
        stateModel: { kind: 'threshold', states: 4 },
      };
    }
    if (!this.isTimeSeries && !this.isPanel) {
      return { version: 1, analysisKind: 'cross_sectional', protocol: this.analysisSpec };
    }
    if (this.isPanel) {
      return {
        version: 1,
        analysisKind: 'panel',
        start: this.start,
        end: this.end,
        observationFrequency: 'monthly',
        assets: this.panelAssets,
        target: {
          kind: 'forward_total_return',
          horizon: this.timeSeriesHorizon,
          horizonUnit: 'trade_day',
        },
        dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: null },
        rankingScope: 'cross_asset',
        volatilityScaling: 'none',
        minimumAssetsPerPeriod: 3,
        portfolio: {
          topFraction: 0.25,
          bottomFraction: 0.25,
          transactionCostPerSide: 0.001,
        },
      };
    }
    return {
      version: 1,
      analysisKind: 'time_series',
      start: this.start,
      end: this.end,
      observationFrequency: 'daily',
      assets: [...this.timeSeriesAssets],
      target: {
        kind: 'forward_total_return',
        horizon: this.timeSeriesHorizon,
        horizonUnit: 'trade_day',
      },
      dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: null },
      inference: { standardError: 'newey_west', lag: 'automatic' },
    };
  }

  public get evaluationUniverse(): FactorUniverseChoice {
    return this.evaluationScope.universe.kind === 'market'
      ? 'cn_a'
      : this.evaluationScope.universe.indexCode;
  }

  /** The editor source no longer matches the immutable source that produced the selected report. */
  public get codeModifiedSinceReport(): boolean {
    if (
      this.mode === 'composite' ||
      this.mode === 'time_series' ||
      this.mode === 'panel' ||
      this.mode === 'macro_regime'
    ) {
      return false;
    }
    const snapshot = this.reportDetail?.factorCodeSnapshot;
    return snapshot !== undefined && this.code !== snapshot;
  }

  /** A report is only current when both its frozen source and run parameters match the draft. */
  public get reportOutdated(): boolean {
    return !!this.reportDetail && (this.codeModifiedSinceReport || this.paramsModified);
  }

  /** A custom factor has unsaved code edits vs. the persisted DB copy → gates the leave guard. */
  public get edited(): boolean {
    return this.mode === 'custom' && this.code !== this.persistedCode;
  }

  /** Changes that would be discarded by switching factors or leaving the workbench. */
  public get hasDraftChanges(): boolean {
    return this.edited || this.paramsModified;
  }

  /** A preset factor is selected → the Agent is in Q&A mode (answers questions, never writes code). */
  public get qaMode(): boolean {
    return (
      (this.mode === 'preset' ||
        this.mode === 'composite' ||
        this.mode === 'time_series' ||
        this.mode === 'panel' ||
        this.mode === 'macro_regime' ||
        (this.mode === 'custom' && this.factorStatus !== 'draft')) &&
      !!this.selectedKey
    );
  }

  private nextSpecVersion(): 6 {
    return 6;
  }

  public setFreq(v: FactorFreq) {
    runInAction(() => {
      this.freq = v;
      this.specVersion = this.nextSpecVersion();
    });
  }
  public setNeutral(v: Neutral) {
    runInAction(() => {
      this.neutral = v;
      this.specVersion = this.nextSpecVersion();
    });
  }
  public setStart(v: string) {
    runInAction(() => {
      this.start = v;
      this.specVersion = this.nextSpecVersion();
    });
  }
  public setEnd(v: string) {
    runInAction(() => {
      this.end = v;
      this.specVersion = this.nextSpecVersion();
    });
  }

  public setUniverseParameter<Key extends keyof FactorMethodologyParams['universe']>(
    key: Key,
    value: FactorMethodologyParams['universe'][Key],
  ) {
    this.specVersion = this.nextSpecVersion();
    this.methodology = {
      ...this.methodology,
      universe: { ...this.methodology.universe, [key]: value },
    };
  }

  public setEvaluationUniverse(value: FactorUniverseChoice) {
    this.specVersion = 6;
    this.evaluationScope = {
      ...this.evaluationScope,
      universe:
        value === 'cn_a' ? { kind: 'market', market: 'cn_a' } : { kind: 'index', indexCode: value },
    };
  }

  public setEvaluationRankingScope(value: FactorEvaluationScopeV1['rankingScope']) {
    this.specVersion = 6;
    this.evaluationScope = { ...this.evaluationScope, rankingScope: value };
  }

  public toggleEvaluationDiagnostic(value: FactorEvaluationScopeV1['diagnostics'][number]) {
    this.specVersion = 6;
    const diagnostics = this.evaluationScope.diagnostics.includes(value)
      ? this.evaluationScope.diagnostics.filter((item) => item !== value)
      : [...this.evaluationScope.diagnostics, value];
    this.evaluationScope = { ...this.evaluationScope, diagnostics };
  }

  public setMinimumWindowCoverage(value: number) {
    this.specVersion = this.nextSpecVersion();
    this.methodology = { ...this.methodology, missing: { minimumWindowCoverage: value } };
  }

  public setOutlierMethod(
    key: keyof FactorMethodologyParams['outliers'],
    method: FactorMethodologyParams['outliers']['factorExposure']['method'],
  ) {
    this.specVersion = this.nextSpecVersion();
    this.methodology = {
      ...this.methodology,
      outliers: {
        ...this.methodology.outliers,
        [key]: { ...this.methodology.outliers[key], method },
      },
    };
  }

  public setCostParameter(key: keyof FactorMethodologyParams['costs'], value: number) {
    this.specVersion = this.nextSpecVersion();
    this.methodology = {
      ...this.methodology,
      costs: { ...this.methodology.costs, [key]: value },
    };
  }

  public setTimeSeriesAssets(values: string[]) {
    const allowed = new Set(this.timeSeriesAllowedAssets);
    this.timeSeriesAssets = values.filter(
      (value): value is TimeSeriesAsset => isTimeSeriesAsset(value) && allowed.has(value),
    );
  }

  public setTimeSeriesHorizon(value: 5 | 20 | 60) {
    this.timeSeriesHorizon = value;
  }

  public setMacroRevisionPolicy(value: MacroRevisionPolicy) {
    this.macroRevisionPolicy = value;
  }

  public setCode(v: string) {
    runInAction(() => (this.code = v));
    this.scheduleDraftSave();
  }

  public applyPendingAgentCode() {
    if (this.pendingAgentCode === null) {
      return;
    }
    runInAction(() => {
      this.code = this.pendingAgentCode!;
      this.pendingAgentCode = null;
    });
    this.scheduleDraftSave();
  }

  public dismissPendingAgentCode() {
    runInAction(() => {
      this.pendingAgentCode = null;
    });
  }
  public setNlText(v: string) {
    runInAction(() => (this.nlText = v));
  }

  /** Pick a factor from the factor library. A preset → readonly code + Q&A agent. A custom factor → load its
   * code + conversation into the editor/chat. Either way, open its newest report by default. */
  public async selectFactor(key: string, preferredReportId?: string) {
    this.analysisPoller.stop(); // drop any in-flight job for the previous factor
    const catalog = this.catalogLoader.result ?? (await this.catalogLoader.run());
    const meta = catalog.find((factor) => factor.key === key);
    const isCustom = meta?.kind === 'custom';
    const isComposite = meta?.kind === 'composite';
    const isTimeSeries = meta?.analysisKind === 'time_series';
    const isPanel = meta?.analysisKind === 'panel';
    const isMacroRegime = meta?.analysisKind === 'macro_regime';
    runInAction(() => {
      this.selectedKey = key;
      this.selectedReportId = preferredReportId ?? '';
      this.mode = isCustom
        ? 'custom'
        : isComposite
          ? 'composite'
          : isTimeSeries
            ? 'time_series'
            : isPanel
              ? 'panel'
              : isMacroRegime
                ? 'macro_regime'
                : 'preset';
      this.definitionAnalysisKind = isTimeSeries
        ? 'time_series'
        : isPanel
          ? 'panel'
          : 'cross_sectional';
      this.targetAssetClasses = meta?.targetAssetClasses;
      this.language = meta?.language === 'python' ? 'python' : 'typescript';
      this.compositeDefinition = isComposite ? structuredClone(meta?.composite ?? null) : null;
      this.specVersion = 6;
      this.evaluationScope = defaultEvaluationScope();
      this.timeSeriesAssets = defaultTimeSeriesAssetsFor(meta);
      this.timeSeriesHorizon = 20;
      this.macroRevisionPolicy = 'latest_vintage';
      if (isMacroRegime) {
        this.timeSeriesAssets = [...MACRO_REGIME_ASSETS];
      }
      this.jobRunning = false;
      this.jobId = null;
      this.logs = [];
      this.nlText = '';
      this.factorKey = meta?.factorKey ?? meta?.strategyKey ?? '';
      this.factorStatus = meta?.status ?? 'draft';
      this.description = meta?.description ?? '';
      this.researchHandoff = null;
      this.sourceResearchExecution = null;
      this.pendingAgentCode = null;
      if (!isCustom) {
        this.code = '';
        this.persistedCode = '';
        this.chatMessages = [];
      }
    });
    if (isComposite) {
      const reports = await this.reportsLoader.run();
      void this.researchSummaryLoader.run();
      if (this.selectedKey !== key) {
        return;
      }
      const target = preferredReportId
        ? reports.items.find((report) => report.id === preferredReportId)
        : reports.items[0];
      if (target && (await this.openReport(target.id))) {
        return;
      }
      runInAction(() => (this.selectedReportId = ''));
      this.reportLoader.reset();
      return;
    }
    let loadedResearchHandoff: ResearchFactorHandoffV1 | null = null;
    try {
      // Presets are code rows too (seeded, readonly) — the same endpoint serves both kinds.
      const factor = await getCustomFactor(key);
      runInAction(() => {
        if (this.selectedKey !== key) {
          return;
        }
        this.code = factor.code;
        this.persistedCode = factor.code;
        this.definitionAnalysisKind =
          factor.analysisKind === 'time_series' || factor.analysisKind === 'panel'
            ? factor.analysisKind
            : 'cross_sectional';
        this.targetAssetClasses = factor.targetAssetClasses ?? meta?.targetAssetClasses;
        this.language = factor.language === 'python' ? 'python' : 'typescript';
        this.chatMessages = isCustom ? (factor.messages ?? []).map(normalizeChatMessage) : [];
        this.factorKey = factor.key;
        this.factorStatus = factor.status ?? (factor.builtin ? 'published' : 'draft');
        this.description = factor.description ?? '';
        this.researchHandoff = isCustom ? (factor.researchHandoff ?? null) : null;
        this.sourceResearchExecution = isCustom ? (factor.sourceResearchExecution ?? null) : null;
      });
      loadedResearchHandoff = isCustom ? (factor.researchHandoff ?? null) : null;
      if (isCustom) {
        void this.reattachTurn(); // a live agent turn for this factor? re-subscribe (snapshot replays)
      }
    } catch {
      /* factor gone (deleted elsewhere) — leave blank */
    }
    const reports = await this.reportsLoader.run();
    void this.researchSummaryLoader.run();
    if (this.selectedKey !== key) {
      return;
    }
    if (preferredReportId) {
      try {
        if (await this.openReport(preferredReportId)) {
          return;
        }
      } catch {
        this.reportLoader.reset();
      }
    }
    const target = reports.items[0];
    if (target) {
      await this.openReport(target.id);
    } else {
      runInAction(() => (this.selectedReportId = ''));
      this.reportLoader.reset();
      this.applyResearchReportSuggestion(loadedResearchHandoff);
    }
  }

  private applyResearchReportSuggestion(handoff: ResearchFactorHandoffV1 | null) {
    const suggestion = handoff?.suggestedReport;
    if (!suggestion || suggestion.analysisKind !== this.definitionAnalysisKind) {
      return;
    }

    runInAction(() => {
      if (suggestion.start) {
        this.start = suggestion.start;
      }
      if (suggestion.end) {
        this.end = suggestion.end;
      }

      switch (suggestion.analysisKind) {
        case 'cross_sectional': {
          this.specVersion = 6;
          if (suggestion.observationFrequency === 'monthly') {
            this.freq = 'month';
          } else if (suggestion.observationFrequency === 'weekly') {
            this.freq = 'week';
          }
          if (suggestion.equityUniverse) {
            this.evaluationScope = {
              ...this.evaluationScope,
              universe:
                suggestion.equityUniverse === 'cn_a'
                  ? { kind: 'market', market: 'cn_a' }
                  : { kind: 'index', indexCode: suggestion.equityUniverse },
            };
          }
          this.methodology = {
            ...this.methodology,
            universe: {
              ...this.methodology.universe,
              ...(suggestion.minimumListingDays !== undefined
                ? { minimumListingDays: suggestion.minimumListingDays }
                : {}),
              ...(suggestion.excludeRiskWarnings !== undefined
                ? { excludeRiskWarnings: suggestion.excludeRiskWarnings }
                : {}),
            },
          };
          break;
        }
        case 'time_series': {
          if (suggestion.assets?.length) {
            const allowed = new Set(this.timeSeriesAllowedAssets);
            const assets = suggestion.assets.filter(
              (asset): asset is TimeSeriesAsset => isTimeSeriesAsset(asset) && allowed.has(asset),
            );
            if (assets.length) {
              this.timeSeriesAssets = [...new Set(assets)];
            }
          }
          break;
        }
        case 'panel':
          break;
      }
    });
  }

  /** Copy the selected preset or owned Factor into an independent editable draft. */
  public async copySelected(sourceId = this.selectedKey) {
    if (!sourceId) {
      return;
    }
    const copy =
      this.selected?.kind === 'composite'
        ? await copyFactorComposite(sourceId)
        : await copyFactor(sourceId);
    await this.catalogLoader.run();
    await this.selectFactor(copy.id);
  }

  /** Persist a brand-new draft before opening its editor or Agent conversation. */
  public async newFactor(analysisKind: EditableFactorAnalysisKind, key: string, name: string) {
    this.analysisPoller.stop();
    const code =
      analysisKind === 'time_series'
        ? DEFAULT_TIME_SERIES_FACTOR_CODE
        : analysisKind === 'panel'
          ? DEFAULT_PANEL_FACTOR_CODE
          : DEFAULT_FACTOR_CODE;
    const created = await createFactor(key, name, code, analysisKind, undefined, 'python');
    await this.catalogLoader.run();
    await this.selectFactor(created.id);
  }

  /** Run one Agent turn for an already persisted draft factor. */
  public async sendAgent(message: string) {
    const text = message.trim();
    if (!text || this.sending) {
      return;
    }
    // A preset is selected → the Agent is Q&A-only (no code, no factor). Answer and stop.
    if (this.qaMode) {
      return this.runQa(text);
    }
    // Continue editing only when the current selection is an editable saved custom factor.
    const editingSaved = !!this.selectedKey && this.selected?.kind === 'custom';
    if (!editingSaved) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage('assistant', i18n.t('factor:saveFailed')),
        ];
      });
      return;
    }
    runInAction(() => {
      this.mode = 'custom';
      this.chatMessages = [...this.chatMessages, textMessage('user', text)];
      this.sending = true;
      this.nlText = '';
    });
    try {
      const codeAtRequest = this.code;
      const { turnId } = await sendFactorAgent(this.selectedKey, text, codeAtRequest);
      await this.turnStream.attach(turnId, this.turnHandlers(codeAtRequest)); // resolves after terminal event
    } catch (e) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage(
            'assistant',
            i18n.t('factor:errorPrefix', {
              message: e instanceof Error ? e.message : i18n.t('factor:requestFailed'),
            }),
          ),
        ];
      });
    } finally {
      runInAction(() => (this.sending = false));
    }
  }

  /** Terminal-event handlers shared by sendAgent / runQa / the refresh reattach. */
  private turnHandlers(codeAtRequest?: string): AgentTurnHandlers {
    return {
      onDone: (done) => {
        runInAction(() => {
          // toolTrace rides along for display only (the server persisted the message without it).
          this.chatMessages = [
            ...this.chatMessages,
            {
              role: 'assistant',
              parts: done.parts,
              turnId: done.turnId,
              toolTrace: done.toolTrace,
            } as ChatMessage,
          ];
          if (done.changed) {
            if (codeAtRequest !== undefined && this.code !== codeAtRequest) {
              this.pendingAgentCode = done.code;
            } else {
              this.code = done.code; // editor updates; analysis result stays until the next run
              this.pendingAgentCode = null;
              this.scheduleDraftSave();
            }
          }
        });
        void this.refreshIdentity();
      },
      onError: (message) => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('factor:errorPrefix', { message })),
          ];
        });
      },
      onCancelled: () => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('factor:turnStopped')),
          ];
        });
      },
    };
  }

  /** Refresh reattach: a saved custom factor with a live turn re-subscribes (snapshot replays). */
  private async reattachTurn() {
    if (!this.selectedKey || this.mode !== 'custom') {
      return;
    }
    runInAction(() => (this.sending = true));
    await this.turnStream.attachRunning(`factor:${this.selectedKey}`, this.turnHandlers(this.code));
    runInAction(() => (this.sending = false)); // resolved at the terminal event (or no live turn)
  }

  private scheduleDraftSave() {
    if (!this.selectedKey || this.mode !== 'custom' || this.factorStatus !== 'draft') {
      return;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveDraft().catch(() => {});
    }, 600);
  }

  private async saveDraft() {
    const id = this.selectedKey;
    const code = this.code;
    if (!id || code === this.persistedCode || this.factorStatus !== 'draft') {
      return;
    }
    await this.saveLoader.run({ id, code });
    if (this.selectedKey === id && this.code === code) {
      runInAction(() => (this.persistedCode = code));
    }
  }

  /** Q&A about the selected preset — answer only, no code, no factor, no persistence (ephemeral chat,
   * still streamed; no reattach since there is no host row to rediscover). */
  private async runQa(text: string) {
    runInAction(() => {
      this.chatMessages = [...this.chatMessages, textMessage('user', text)];
      this.sending = true;
      this.nlText = '';
    });
    try {
      const { turnId } = await factorQa(this.chatMessages.slice(0, -1), text, this.selected?.label);
      await this.turnStream.attach(turnId, this.turnHandlers());
    } catch (e) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage(
            'assistant',
            i18n.t('factor:errorPrefix', {
              message: e instanceof Error ? e.message : i18n.t('factor:requestFailed'),
            }),
          ),
        ];
      });
    } finally {
      runInAction(() => (this.sending = false));
    }
  }

  /** Delete a custom factor; deselect it if it was open, then refresh the catalog. */
  public async removeFactor(id: string) {
    await deleteCustomFactor(id);
    if (this.selectedKey === id) {
      runInAction(() => {
        this.selectedKey = '';
        this.selectedReportId = '';
        this.mode = 'preset';
        this.definitionAnalysisKind = 'cross_sectional';
        this.language = 'python';
        this.code = '';
        this.persistedCode = '';
        this.chatMessages = [];
        this.factorKey = '';
        this.factorStatus = 'draft';
        this.description = '';
        this.pendingAgentCode = null;
      });
      this.reportLoader.reset();
      this.reportsLoader.reset();
    }
    await this.catalogLoader.run();
  }

  public async saveComposite(
    definition: FactorCompositeDefinition,
    id?: string,
  ): Promise<FactorCompositeResource> {
    const saved = id
      ? await updateFactorComposite(id, definition)
      : await createFactorComposite(definition);
    await this.catalogLoader.run();
    await this.selectFactor(saved.id);
    return saved;
  }

  public async removeComposite(id: string) {
    await deleteFactorComposite(id);
    if (this.selectedKey === id) {
      runInAction(() => {
        this.selectedKey = '';
        this.selectedReportId = '';
        this.mode = 'preset';
        this.compositeDefinition = null;
        this.logs = [];
      });
      this.reportLoader.reset();
      this.reportsLoader.reset();
    }
    await this.catalogLoader.run();
  }

  /** Open an immutable report, restore its parameters, and reattach its live Job when needed. */
  public async openReport(reportId: string): Promise<boolean> {
    this.analysisPoller.stop();
    runInAction(() => {
      this.selectedReportId = reportId;
      this.logs = [];
      this.jobRunning = false;
      this.jobId = null;
      this.pollingReportId = null;
    });
    const detail = await this.reportLoader.run(reportId);
    if (detail.factor !== this.selectedKey || detail.id !== this.selectedReportId) {
      runInAction(() => (this.selectedReportId = ''));
      this.reportLoader.reset();
      return false;
    }

    if (
      detail.analysisKind === 'time_series' &&
      detail.researchSpec.analysisKind === 'time_series'
    ) {
      const spec = detail.researchSpec;
      runInAction(() => {
        this.mode = this.selected?.kind === 'custom' ? 'custom' : 'time_series';
        this.definitionAnalysisKind = 'time_series';
        if (this.mode === 'time_series' && detail.factorCodeSnapshot?.includes('defineFactorV2')) {
          this.code = detail.factorCodeSnapshot;
          this.persistedCode = detail.factorCodeSnapshot;
        }
        this.start = spec.start;
        this.end = spec.end;
        this.timeSeriesAssets = spec.assets.filter(isTimeSeriesAsset);
        this.timeSeriesHorizon = ([5, 20, 60] as const).includes(spec.target.horizon as 5 | 20 | 60)
          ? (spec.target.horizon as 5 | 20 | 60)
          : 20;
      });
      if (detail.status === 'running' && detail.jobId) {
        this.startPolling(detail.jobId, detail.id);
      }
      return true;
    }
    if (detail.analysisKind === 'panel' && detail.researchSpec.analysisKind === 'panel') {
      const spec = detail.researchSpec;
      runInAction(() => {
        this.mode =
          this.selected?.kind === 'custom'
            ? 'custom'
            : this.selected?.kind === 'composite'
              ? 'composite'
              : 'panel';
        this.definitionAnalysisKind = 'panel';
        if (this.mode === 'panel' && detail.factorCodeSnapshot?.includes('defineFactorV2')) {
          this.code = detail.factorCodeSnapshot;
          this.persistedCode = detail.factorCodeSnapshot;
        }
        this.start = spec.start;
        this.end = spec.end;
        this.timeSeriesHorizon = ([5, 20, 60] as const).includes(spec.target.horizon as 5 | 20 | 60)
          ? (spec.target.horizon as 5 | 20 | 60)
          : 20;
      });
      if (detail.status === 'running' && detail.jobId) {
        this.startPolling(detail.jobId, detail.id);
      }
      return true;
    }
    if (
      detail.analysisKind === 'macro_regime' &&
      detail.researchSpec.analysisKind === 'macro_regime'
    ) {
      const spec = detail.researchSpec;
      runInAction(() => {
        this.mode = 'macro_regime';
        this.code = detail.factorCodeSnapshot ?? this.code;
        this.persistedCode = this.code;
        this.start = spec.start;
        this.end = spec.end;
        this.timeSeriesAssets = spec.targetAssets.filter(isTimeSeriesAsset);
        this.timeSeriesHorizon = ([5, 20, 60] as const).includes(spec.target.horizon as 5 | 20 | 60)
          ? (spec.target.horizon as 5 | 20 | 60)
          : 20;
        this.macroRevisionPolicy = spec.dataPolicy.revisionPolicy;
      });
      if (detail.status === 'running' && detail.jobId) {
        this.startPolling(detail.jobId, detail.id);
      }
      return true;
    }

    const spec = detail.spec;
    if (!spec) {
      return false;
    }

    runInAction(() => {
      this.freq = spec.freq;
      this.neutral = spec.neutral;
      this.start = spec.start;
      this.end = spec.end;
      this.specVersion = spec.version;
      this.evaluationScope =
        spec.version === 5 || spec.version === 6
          ? structuredClone(spec.evaluationScope)
          : defaultEvaluationScope();
      this.compositeDefinition =
        spec.version === 4 || (spec.version === 6 && spec.composite)
          ? structuredClone(spec.composite)
          : this.mode === 'composite'
            ? this.compositeDefinition
            : null;
      this.methodology =
        spec.version !== 1
          ? {
              universe: {
                ...structuredClone(spec.universe),
                excludeRiskWarnings:
                  'excludeRiskWarnings' in spec.universe
                    ? spec.universe.excludeRiskWarnings
                    : DEFAULT_METHODOLOGY.universe.excludeRiskWarnings,
                excludePendingDelisting:
                  'excludePendingDelisting' in spec.universe
                    ? spec.universe.excludePendingDelisting
                    : DEFAULT_METHODOLOGY.universe.excludePendingDelisting,
              },
              missing: structuredClone(spec.missing),
              outliers: structuredClone(spec.outliers),
              costs: structuredClone(spec.costs),
            }
          : defaultMethodology();
    });
    if (detail.status === 'running' && detail.jobId) {
      this.startPolling(detail.jobId, detail.id);
    }
    return true;
  }

  /** Commit custom code, create a new immutable report, then stream its one-to-one Job. */
  public async runAnalysis(researchIntent: FactorResearchIntentV1) {
    if (this.mode === 'custom') {
      if (!this.selectedKey) {
        return;
      }
      if (this.code !== this.persistedCode) {
        try {
          if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
          }
          await this.saveDraft();
          void refreshFactorMetadata(this.selectedKey, this.code).then(() =>
            this.refreshIdentity(),
          );
        } catch (e) {
          await this.reportLoader.run(Promise.reject(e)).catch(() => {});
          return;
        }
      }
      if (
        this.definitionAnalysisKind === 'time_series' ||
        this.definitionAnalysisKind === 'panel'
      ) {
        try {
          const factor = await getCustomFactor(this.selectedKey);
          const targetAssetClasses = factor.targetAssetClasses ?? this.targetAssetClasses;
          runInAction(() => {
            this.targetAssetClasses = targetAssetClasses;
            if (this.definitionAnalysisKind === 'time_series' && this.selected) {
              const allowed = new Set(
                allowedTimeSeriesAssetsFor({
                  ...this.selected,
                  targetAssetClasses,
                }),
              );
              this.timeSeriesAssets = this.timeSeriesAssets.filter((asset) => allowed.has(asset));
            }
          });
        } catch (e) {
          await this.reportLoader.run(Promise.reject(e)).catch(() => {});
          return;
        }
      }
    }
    runInAction(() => {
      this.logs = [];
      this.jobRunning = true;
    });
    try {
      const assetResearch = this.isTimeSeries || this.isPanel || this.isMacroRegime;
      const protocol = this.analysisSpec;
      const researchSpec = this.researchSpec;
      const spec = assetResearch ? researchSpec : protocol;
      const response = await runFactorAnalysis(
        this.selectedKey,
        spec,
        researchIntent,
        this.selectedReportId || null,
      );
      const summary: FactorReportSummary = {
        id: response.reportId,
        factor: this.selectedKey,
        analysisKind: this.isMacroRegime
          ? 'macro_regime'
          : this.isPanel
            ? 'panel'
            : this.isTimeSeries
              ? 'time_series'
              : 'cross_sectional',
        status: 'running',
        phase: 'explore',
        ...(assetResearch ? {} : { spec: protocol }),
        researchSpec,
        jobId: response.jobId,
        createdAt: new Date().toISOString(),
      };
      runInAction(() => {
        const current = this.reportsLoader.result ?? { items: [] };
        const historyItem = current.items.find((report) => report.id === summary.id) ?? summary;
        this.reportsLoader.result = {
          ...current,
          items: [historyItem, ...current.items.filter((report) => report.id !== summary.id)],
        };
        this.selectedReportId = response.reportId;
      });
      await this.reportLoader.run(response.reportId);
      this.startPolling(response.jobId, response.reportId);
    } catch (e) {
      await this.reportLoader.run(Promise.reject(e)).catch(() => {});
      this.finishJob();
    }
  }

  public async runHoldout() {
    if (!this.selectedReportId) {
      return;
    }
    const response = await runFactorHoldout(this.selectedReportId);
    runInAction(() => {
      this.selectedReportId = response.reportId;
      this.jobRunning = true;
    });
    await this.reportLoader.run(response.reportId);
    void this.reportsLoader.run();
    this.startPolling(response.jobId, response.reportId);
  }

  public async revealHoldout() {
    if (!this.selectedReportId) {
      return;
    }
    const detail = await revealFactorHoldout(this.selectedReportId);
    runInAction(() => (this.reportLoader.result = detail));
    void this.reportsLoader.run();
    void this.researchSummaryLoader.run();
  }

  public async publishSelectedReport(): Promise<PublishedFactor> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveDraft();
    const factor = await this.publishLoader.run(this.selectedReportId);
    runInAction(() => {
      this.factorStatus = factor.status;
      this.factorKey = factor.key;
    });
    await this.catalogLoader.run();
    return factor;
  }

  public async archiveSelected(): Promise<PublishedFactor> {
    const factor = await this.archiveLoader.run();
    runInAction(() => (this.factorStatus = factor.status));
    await this.catalogLoader.run();
    return factor;
  }

  /** Reload mutable metadata after the server-side Agent/metadata hook has completed. */
  private async refreshIdentity() {
    if (!this.selectedKey || this.mode !== 'custom') {
      return;
    }
    try {
      const selectedKey = this.selectedKey;
      const factor = await getCustomFactor(selectedKey);
      runInAction(() => {
        if (this.selectedKey !== selectedKey) {
          return;
        }
        this.factorKey = factor.key;
        this.factorStatus = factor.status ?? 'draft';
        this.description = factor.description ?? '';
        this.targetAssetClasses = factor.targetAssetClasses ?? this.targetAssetClasses;
      });
      await this.catalogLoader.run();
    } catch {
      /* best-effort */
    }
  }

  private startPolling(jobId: string, reportId: string) {
    this.jobId = jobId;
    this.pollingReportId = reportId;
    this.since = 0;
    runInAction(() => {
      this.jobRunning = true;
      this.queuePosition = null;
    });
    this.analysisPoller.start();
  }

  /** One poll tick — append new logs; on finish fetch the persisted report. Returns false to stop. */
  private async pollOnce(): Promise<false | void> {
    const jobId = this.jobId;
    const reportId = this.pollingReportId;
    if (!jobId || !reportId) {
      return false;
    }
    try {
      const job = await pollFactorJob(jobId, this.since);
      if (this.jobId !== jobId || this.pollingReportId !== reportId) {
        return false;
      }
      runInAction(() => {
        this.queuePosition = job.status === 'queued' ? (job.queuePosition ?? null) : null;
      });
      if (job.logs.length) {
        runInAction(() => (this.logs = [...this.logs, ...job.logs]));
        this.since = job.nextSince;
      }
      if (job.status === 'done' || job.status === 'error' || job.status === 'stale') {
        await this.reportLoader.run(reportId);
        void this.reportsLoader.run();
        void this.researchSummaryLoader.run();
        this.finishJob();
        return false;
      }
    } catch {
      this.finishJob();
      return false;
    }
  }

  private finishJob() {
    runInAction(() => {
      this.jobRunning = false;
      this.jobId = null;
      this.pollingReportId = null;
      this.queuePosition = null;
    });
  }

  // —— Correlation matrix ——

  public setCorrKeys(keys: string[]) {
    runInAction(() => (this.corrKeys = keys.slice(0, 8))); // API caps at 8
  }

  /** The current correlation report, guarded to the current selection (avoids a stale render). */
  public get correlation(): FactorCorrelation | null {
    const r = this.correlationLoader.result;
    if (!r) {
      return null;
    }
    const want = [...this.corrKeys].sort().join(',');
    const got = [...r.keys.filter((k) => k !== 'size')].sort().join(',');
    return want === got ? r : null;
  }

  /** Run (or view, if cached) the correlation matrix over the selected factors + the shared freq/range. */
  public async runCorrelation(refresh = false) {
    if (this.corrKeys.length < 2) {
      return;
    }
    runInAction(() => {
      this.corrLogs = [];
      this.corrRunning = true;
    });
    try {
      const res = await runFactorCorrelation(
        this.corrKeys,
        this.freq,
        this.start,
        this.end,
        refresh,
      );
      if ('report' in res) {
        await this.correlationLoader.run(Promise.resolve(res.report));
        this.finishCorr();
      } else {
        this.startCorrPolling(res.jobId);
      }
    } catch (e) {
      await this.correlationLoader.run(Promise.reject(e)).catch(() => {});
      this.finishCorr();
    }
  }

  private startCorrPolling(jobId: string) {
    this.corrJobId = jobId;
    this.corrSince = 0;
    runInAction(() => (this.corrRunning = true));
    this.correlationPoller.start();
  }

  private async pollCorrelationOnce(): Promise<false | void> {
    try {
      const job = await pollFactorJob(this.corrJobId!, this.corrSince);
      if (job.logs.length) {
        runInAction(() => (this.corrLogs = [...this.corrLogs, ...job.logs]));
        this.corrSince = job.nextSince;
      }
      if (job.status === 'done') {
        const report = await getFactorCorrelation(this.corrKeys, this.freq, this.start, this.end);
        await this.correlationLoader.run(Promise.resolve(report));
        this.finishCorr();
        return false;
      }
      if (job.status === 'error' || job.status === 'stale') {
        const msg =
          job.status === 'stale'
            ? i18n.t('factor:analysisInterrupted')
            : job.error || i18n.t('factor:analysisFailed');
        await this.correlationLoader.run(Promise.reject(new Error(msg))).catch(() => {});
        this.finishCorr();
        return false;
      }
    } catch {
      this.finishCorr();
      return false;
    }
  }

  private finishCorr() {
    runInAction(() => (this.corrRunning = false));
  }

  /** On opening the correlation modal, re-attach to a still-running job (survives a refresh). */
  public async reattachCorrelation() {
    if (this.corrKeys.length < 2) {
      return;
    }
    try {
      const { jobId } = await findCorrelationRunningJob(
        this.corrKeys,
        this.freq,
        this.start,
        this.end,
      );
      if (jobId) {
        this.startCorrPolling(jobId);
      }
    } catch {
      /* no live job */
    }
  }
}

function assetResearchDraftIdentity(
  spec:
    | TimeSeriesFactorResearchSpecV1
    | PanelFactorResearchSpecV1
    | MacroRegimeFactorResearchSpecV1,
): TimeSeriesFactorResearchSpecV1 | PanelFactorResearchSpecV1 | MacroRegimeFactorResearchSpecV1 {
  if (spec.analysisKind === 'macro_regime') {
    return {
      version: 1,
      analysisKind: 'macro_regime',
      start: spec.start,
      end: spec.end,
      observationFrequency: spec.observationFrequency,
      targetAssets: [...spec.targetAssets],
      target: structuredClone(spec.target),
      dataPolicy: {
        pointInTime: true,
        revisionPolicy: spec.dataPolicy.revisionPolicy,
        dataCutoff: null,
      },
      stateModel: structuredClone(spec.stateModel),
    };
  }
  if (spec.analysisKind === 'panel') {
    return {
      version: 1,
      analysisKind: 'panel',
      start: spec.start,
      end: spec.end,
      observationFrequency: spec.observationFrequency,
      assets: spec.assets.map((asset) => ({ ...asset })),
      target: structuredClone(spec.target),
      dataPolicy: {
        pointInTime: true,
        revisionPolicy: spec.dataPolicy.revisionPolicy,
        dataCutoff: null,
      },
      rankingScope: spec.rankingScope,
      volatilityScaling: spec.volatilityScaling,
      minimumAssetsPerPeriod: spec.minimumAssetsPerPeriod,
      portfolio: structuredClone(spec.portfolio),
    };
  }
  return {
    version: 1,
    analysisKind: 'time_series',
    start: spec.start,
    end: spec.end,
    observationFrequency: spec.observationFrequency,
    assets: [...spec.assets],
    target: structuredClone(spec.target),
    dataPolicy: {
      pointInTime: true,
      revisionPolicy: spec.dataPolicy.revisionPolicy,
      dataCutoff: null,
    },
    inference: structuredClone(spec.inference),
  };
}
