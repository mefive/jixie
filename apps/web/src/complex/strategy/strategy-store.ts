import type { CodeChangeProposalV1 } from '@jixie/shared';
import { acceptStrategyCodeChange } from '@src/api/strategy';
import type { ResearchDataReferenceV1 } from '@jixie/shared';
import {
  embeddedUserMessage,
  retainEmbeddedPart,
  upsertAssistantMessage,
} from '@src/components/embedded-analysis/chat-messages';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  textMessage,
  DEFAULT_BACKTEST_COST,
  DEFAULT_BACKTEST_END,
  DEFAULT_BACKTEST_INITIAL_CASH,
  DEFAULT_BACKTEST_START,
  type BacktestConfig,
  type BacktestReportDetail,
  type BacktestReportSummary,
  type BacktestSummary,
  type ChatMessage,
  type CostConfig,
  type FactorMeta,
  type LogLine,
  type ResearchStrategyHandoffV1,
  type SavedStrategy,
  type StrategyCard,
  type StrategyDeployment,
  type StrategyScanReport,
  type StrategyScanReportSummary,
  type StrategyScanSpec,
  type StrategyParamValue,
  type StrategyLanguage,
} from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import i18n from '@src/i18n';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import {
  createStrategy,
  deleteStrategy,
  findActiveBacktestJob,
  findActiveStrategyScanJob,
  getBacktestReport,
  getStrategy,
  getStrategyScanReport,
  inspectStrategyParameters,
  listStrategyScanReports,
  listBacktestReports,
  listStrategies,
  pollBacktest,
  pollStrategyScan,
  sendAgent,
  submitBacktest,
  submitStrategyScan,
} from '@src/api/strategy';
import {
  deployBacktestReport,
  listStrategyDeployments,
  pauseStrategyDeployment,
} from '@src/api/signals';
import {
  getFactorComposite,
  getCustomFactor,
  getFactorCatalog,
  getFactorReport,
} from '@src/api/factor';
import { fetchIndexSeries } from '@src/api/market';
import { DEFAULT_CODE, DEFAULT_PYTHON_CODE } from './default-strategy';
import { BENCHMARKS, type BenchmarkSeries } from './benchmarks';
import { pushRecent, readRecents, removeRecent } from './recents';
import { PANEL_ASSET_IDS } from '../factor/panel-universe';

/**
 * 指定策略路由的已保存身份与初始状态。
 *
 * Configure saved strategy identity and initial route state.
 */
type StrategySetupParams = { id?: string; report?: string; isNew?: boolean; factorKey?: string };

/**
 * 区分部署与暂停动作，供统一异步变更。
 *
 * Discriminate deployment and pause actions for async mutations.
 */
type DeploymentAction =
  | { type: 'deploy'; reportId: string }
  | { type: 'pause'; deploymentId: string };

/**
 * 策略工作台保留编辑状态；Agent 建议独立持久化，用户接受时才保存源码。
 * 手动参数与源码修改仍随明确提交回测保存，接受建议不会启动回测。
 *
 * Keep editor state separate from durable Agent proposals; only explicit acceptance saves generated source.
 * Manual code and parameter edits are committed with a backtest; acceptance never starts one.
 */
export class StrategyStore extends BaseStore<StrategySetupParams> {
  public name = ''; // LLM-derived name; regenerated from the code on each run (the strategy name, not the code's own)
  public start = DEFAULT_BACKTEST_START;
  public end = DEFAULT_BACKTEST_END;
  public initialCash = DEFAULT_BACKTEST_INITIAL_CASH;
  public cost: CostConfig = { ...DEFAULT_BACKTEST_COST };
  public code = DEFAULT_CODE;
  public language: StrategyLanguage = 'typescript';
  public researchHandoff: ResearchStrategyHandoffV1 | null = null;
  public sourceResearchExecution: SavedStrategy['sourceResearchExecution'] = null;

  public nlText = ''; // the Agent chat draft / hero prompt

  public chatMessages: ChatMessage[] = []; // the Agent conversation for this strategy (persisted per strategy)
  public sending = false; // an Agent turn is in flight
  public turnStream = new AgentTurnStream(); // the in-flight turn's SSE mirror (pending bubble)

  public logLines: LogLine[] = []; // live backtest progress (streamed via polling), tagged system/user
  public result: BacktestSummary | null = null; // a finished run OR the saved last-result on reopen
  public activeBacktestReportId: string | null = null;
  public error: string | null = null; // backtest failure message
  public queuePosition: number | null = null;
  public savedId: string | null = null; // this strategy's DB id (for the URL)
  public savedConfig = ''; // run-relevant config at the LAST RUN (or '' if never run) — baseline for `dirty`
  public persistedConfig = ''; // run-relevant config as PERSISTED in the DB (create/run/open) — baseline for `edited`
  public initializing = false; // opening the initial strategy on mount — render a neutral loader, not the hero
  public scanReport: StrategyScanReport | null = null;
  public scanLogLines: LogLine[] = [];
  public scanError: string | null = null;
  public scanQueuePosition: number | null = null;
  public deployments: StrategyDeployment[] = [];
  public deploymentError: string | null = null;

  private chatSelection = 0;
  private jobId: string | null = null; // polling cursor for the current backtest
  private since = 0;
  private scanReportId: string | null = null;
  private scanJobId: string | null = null;
  private scanSince = 0;

  public backtestPoller = new PollingModel();
  public scanPoller = new PollingModel();
  public codeChangeLoader = new LoaderModel<CodeChangeProposalV1>();
  public savedLoader = new LoaderModel<StrategyCard[]>(); // My strategies / History cards
  public backtestHistoryLoader = new LoaderModel<BacktestReportSummary[]>();
  public backtestReportLoader = new LoaderModel<BacktestReportDetail>();
  public backtestComparisonLoader = new LoaderModel<BacktestReportDetail>();
  public benchmarkLoader = new LoaderModel<BenchmarkSeries>();
  public scanParametersLoader = new LoaderModel<Record<string, StrategyParamValue>>();
  public scanHistoryLoader = new LoaderModel<StrategyScanReportSummary[]>();
  public scanReportLoader = new LoaderModel<StrategyScanReport>();
  public deploymentLoader = new LoaderModel<StrategyDeployment[]>();
  public deploymentActionLoader = new LoaderModel<StrategyDeployment>();
  public factorLoader = new LoaderModel<{ factor: FactorMeta; assets: string[] } | null>();

  /**
   * 登记策略配置、报告及运行状态的可观察属性。
   *
   * Register observable strategy configuration, report and execution state.
   */
  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      name: observable.ref,
      start: observable.ref,
      end: observable.ref,
      initialCash: observable.ref,
      cost: observable.ref,
      code: observable.ref,
      language: observable.ref,
      researchHandoff: observable.ref,
      sourceResearchExecution: observable.ref,
      nlText: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      logLines: observable.ref,
      result: observable.ref,
      activeBacktestReportId: observable.ref,
      error: observable.ref,
      queuePosition: observable.ref,
      savedId: observable.ref,
      savedConfig: observable.ref,
      persistedConfig: observable.ref,
      initializing: observable.ref,
      scanReport: observable.ref,
      scanLogLines: observable.ref,
      scanError: observable.ref,
      scanQueuePosition: observable.ref,
      deployments: observable.ref,
      deployment: computed,
      canDeployReport: computed,
      deploymentError: observable.ref,
      config: computed,
      dirty: computed,
      edited: computed,
      isFresh: computed,
      viewingLatestBacktest: computed,
    });
  }

  /**
   * 配置策略、报告比较、扫描、部署与 Agent 流状态，注册所有清理。
   *
   * Initialize strategy, report comparison, scan, deployment and agent state with cleanup.
   */
  public setup(params: StrategySetupParams) {
    super.setup(params);
    this.codeChangeLoader.setup({
      preserveResult: false,
      request: (input: { entityId: string; proposalId: string; beforeCode: string }) =>
        acceptStrategyCodeChange(input.entityId, input.proposalId, input.beforeCode),
    });
    this.registCleaner(() => this.codeChangeLoader.cleanup());
    this.backtestPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollOnce() });
    this.scanPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollScanOnce() });
    this.savedLoader.setup({ request: () => listStrategies() });
    this.backtestHistoryLoader.setup({
      request: (strategyId: string) => listBacktestReports(strategyId),
    });
    this.backtestReportLoader.setup({
      preserveResult: false,
      request: (reportId: string) => getBacktestReport(reportId),
    });
    this.backtestComparisonLoader.setup({
      request: (reportId: string) => getBacktestReport(reportId),
    });
    this.benchmarkLoader.setup({
      request: async ({ start, end }: { start: string; end: string }) => {
        const series = await Promise.all(
          BENCHMARKS.map(async ({ code }) => {
            const result = await fetchIndexSeries(code, start, end);
            return [code, result.points] as const;
          }),
        );
        return Object.fromEntries(series) as BenchmarkSeries;
      },
    });
    this.scanParametersLoader.setup({
      request: async (code: string) => (await inspectStrategyParameters(code)).parameters,
    });
    this.scanHistoryLoader.setup({
      request: (strategyId: string) => listStrategyScanReports(strategyId),
    });
    this.scanReportLoader.setup({ request: (reportId: string) => getStrategyScanReport(reportId) });
    this.deploymentLoader.setup({
      request: (strategyId: string) => listStrategyDeployments(strategyId),
    });
    this.deploymentActionLoader.setup({
      request: (action: DeploymentAction) =>
        action.type === 'deploy'
          ? deployBacktestReport(action.reportId)
          : pauseStrategyDeployment(action.deploymentId),
    });
    this.factorLoader.setup({
      /**
       * 读取已发布因子及批准报告，为策略引用补全提供可用资产范围。
       *
       * Load a published factor and approved report to describe supported assets for strategy references.
       */
      request: async (factorKey: string) => {
        const factor = (await getFactorCatalog()).find(
          (candidate) => candidate.strategyKey === factorKey && candidate.status === 'published',
        );
        if (!factor) {
          return null;
        }
        const detail =
          factor.kind === 'composite'
            ? await getFactorComposite(factor.key)
            : await getCustomFactor(factor.key);
        const report = detail.approvedReportId
          ? await getFactorReport(detail.approvedReportId)
          : null;
        const assets =
          report?.researchSpec.analysisKind === 'time_series'
            ? report.researchSpec.assets
            : report?.researchSpec.analysisKind === 'panel'
              ? report.researchSpec.assets.map((asset) => asset.assetId)
              : factor.analysisKind === 'panel'
                ? [...PANEL_ASSET_IDS]
                : [];
        return { factor, assets };
      },
    });
    this.registCleaner(() => this.backtestPoller.cleanup());
    this.registCleaner(() => this.scanPoller.cleanup());
    this.registCleaner(() => this.savedLoader.cleanup());
    this.registCleaner(() => this.backtestHistoryLoader.cleanup());
    this.registCleaner(() => this.backtestReportLoader.cleanup());
    this.registCleaner(() => this.backtestComparisonLoader.cleanup());
    this.registCleaner(() => this.benchmarkLoader.cleanup());
    this.registCleaner(() => this.scanParametersLoader.cleanup());
    this.registCleaner(() => this.scanHistoryLoader.cleanup());
    this.registCleaner(() => this.scanReportLoader.cleanup());
    this.registCleaner(() => this.deploymentLoader.cleanup());
    this.registCleaner(() => this.deploymentActionLoader.cleanup());
    this.registCleaner(() => this.factorLoader.cleanup());
    this.registCleaner(() => {
      this.chatSelection += 1;
      this.turnStream.detach();
    }); // drop the SSE subscription; the turn keeps running
    void this.savedLoader.run(); // prime My strategies (also feeds the hero's Recent-visits cards)
    // A fresh (never-run) strategy: empty run-baseline → dirty → Run-backtest enabled; but the pristine
    // skeleton IS the "persisted" state (nothing to lose) → not edited → no leave guard.
    this.savedConfig = '';
    this.persistedConfig = this.configKey();
    if (params.isNew && params.factorKey) {
      void this.prefillFactor(params.factorKey).catch((error): void => {
        console.error('Failed to prefill factor in Strategy workbench', error);
      });
    }
    // Resolve the initial view: `?new=1` forces the blank hero; else an explicit ?id; else the
    // most-recently-opened strategy (so re-entering /strategy lands on your last work, not the blank hero);
    // else the blank starter. When we WILL open one, set `initializing` synchronously so the first paint
    // is a neutral loader — not the hero / empty workbench flashing before openSaved resolves.
    const initialId = params.isNew ? '' : params.id || readRecents()[0];
    if (initialId) {
      this.initializing = true;
      void this.openSaved(initialId, params.report).finally(() =>
        runInAction(() => (this.initializing = false)),
      );
    }
  }

  private async prefillFactor(factorKey: string): Promise<void> {
    const loaded = await this.factorLoader.run(factorKey);
    if (!loaded) {
      return;
    }
    runInAction(() => {
      const isTimeSeries = loaded.factor.analysisKind === 'time_series';
      const isPanel = loaded.factor.analysisKind === 'panel';
      this.nlText = i18n.t(
        isPanel
          ? 'strategy:factorPanelStarterPrompt'
          : isTimeSeries
            ? 'strategy:factorTimeSeriesStarterPrompt'
            : 'strategy:factorStarterPrompt',
        {
          name: loaded.factor.label,
          key: loaded.factor.strategyKey,
          assets: loaded.assets.join('、'),
        },
      );
    });
  }

  /**
   * 判断回测是否在运行，供加载和进度显示。
   *
   * True while a backtest is running (drives the loading state + progress log).
   */
  public get running(): boolean {
    return this.backtestPoller.running;
  }

  /**
   * 识别尚未保存、编辑或运行的初始策略，供提示词优先入口。
   *
   * Untouched starter strategy (no saved id, default code, no run, no chat) → show the prompt-first hero.
   */
  public get isFresh(): boolean {
    return (
      !this.savedId && !this.result && this.code === DEFAULT_CODE && this.chatMessages.length === 0
    );
  }

  /**
   * 比较上次运行相关配置，名称变化不使回测失效。
   *
   * The run-relevant config (range/capital/code — NOT name) changed since the last run. Gates Run-backtest:
   * a never-run strategy has an empty baseline → dirty → runnable; a fresh run resets the baseline.
   */
  public get dirty(): boolean {
    return this.configKey() !== this.savedConfig;
  }

  /**
   * 比较当前代码和参数与数据库持久配置，供未保存离开提示。
   *
   * The code/params differ from what's PERSISTED in the DB — i.e. there are unrun edits that leaving
   * would lose. Gates the leave guard (New / switch strategy / refresh). A just-opened strategy is NOT edited (even
   * if never run → dirty), so opening one doesn't false-warn.
   */
  public get edited(): boolean {
    return this.configKey() !== this.persistedConfig;
  }

  /**
   * 依据不可变报告身份选择部署，忽略当前可变编辑状态。
   *
   * Report identity governs deployment; mutable editor state is irrelevant.
   */
  public get deployment(): StrategyDeployment | null {
    return (
      this.deployments.find(
        (deployment) =>
          deployment.backtestReportId === this.activeBacktestReportId &&
          deployment.backtestReportId !== null &&
          deployment.status === 'active',
      ) ?? null
    );
  }

  public get canDeployReport(): boolean {
    const report = this.backtestHistoryLoader.result?.find(
      (candidate) => candidate.id === this.activeBacktestReportId,
    );
    return !!report && report.language === 'typescript';
  }

  /**
   * 判断是否正在查看最近回测，保持独立成交页与最近运行关联。
   *
   * The standalone trade page remains tied to the latest run.
   */
  public get viewingLatestBacktest(): boolean {
    const latestReportId = this.backtestHistoryLoader.result?.[0]?.id;
    return !latestReportId || this.activeBacktestReportId === latestReportId;
  }

  /**
   * 将日期、资本和作者代码组装为可运行回测配置。
   *
   * Range/capital + the strategy code → a runnable BacktestConfig.
   */
  public get config(): BacktestConfig {
    return {
      name: this.name.trim() || '未命名策略',
      start: this.start,
      end: this.end,
      initialCash: this.initialCash,
      cost: this.cost,
      language: this.language,
      runtimeVersion: this.language === 'python' ? 'py-v1' : 'ts-v1',
      code: this.code,
    };
  }

  public setField<K extends keyof StrategyStore>(key: K, value: StrategyStore[K]) {
    runInAction(() => {
      (this as StrategyStore)[key] = value;
    });
  }

  public setCostField<K extends keyof CostConfig>(key: K, value: CostConfig[K]) {
    runInAction(() => {
      this.cost = { ...this.cost, [key]: value };
    });
  }

  public loadScanParameters() {
    return this.scanParametersLoader.run(this.code);
  }

  public async runScan(spec: StrategyScanSpec) {
    await this.ensureStrategy();
    if (!this.savedId) {
      runInAction(() => (this.scanError = i18n.t('strategy:storeSaveFailedNoBacktest')));
      return;
    }

    try {
      const { reportId, jobId } = await submitStrategyScan(this.savedId, this.config, spec);
      runInAction(() => {
        this.scanReport = null;
        this.scanLogLines = [];
        this.scanError = null;
      });
      this.startScanPolling(jobId, reportId);
      void this.scanHistoryLoader.run(this.savedId);
    } catch (error) {
      runInAction(() => {
        this.scanError =
          error instanceof Error ? error.message : i18n.t('strategy:scanSubmitFailed');
      });
    }
  }

  public async loadScanReport(reportId: string) {
    try {
      const report = await this.scanReportLoader.run(reportId);
      runInAction(() => {
        this.scanReport = report;
        this.scanError =
          report.error ?? (report.status === 'stale' ? i18n.t('strategy:scanInterrupted') : null);
      });
    } catch (error) {
      runInAction(() => {
        this.scanError = error instanceof Error ? error.message : i18n.t('strategy:scanLoadFailed');
      });
    }
  }

  /**
   * 先确保策略持久化，再发送 Agent 消息并连接增量响应。
   *
   * One Agent turn — streamed. Append the user message locally, ensure the strategy exists (the
   * first prompt creates it, LLM-named from that request), START the turn (server persists both the
   * user message and the reply onto the strategy row), then subscribe to its SSE stream; the reply
   * lands via turnHandlers. Code is NOT persisted here (only a run commits config).
   */
  public async sendAgent(
    message: string,
    includeReport = true,
    dataReferences: ResearchDataReferenceV1[] = [],
  ) {
    const text = message.trim();
    if (!text || this.sending) {
      return;
    }
    const selection = this.chatSelection;
    runInAction(() => {
      this.chatMessages = [...this.chatMessages, embeddedUserMessage(text, dataReferences)];
      this.sending = true;
      this.nlText = '';
    });
    // First prompt → create the strategy so the conversation has a home (named from this request).
    await this.ensureStrategy(text);
    if (selection !== this.chatSelection) {
      return;
    }
    if (!this.savedId) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage('assistant', i18n.t('strategy:storeChatStartFailed')),
        ];
        this.sending = false;
      });
      return;
    }
    try {
      const { turnId } = await sendAgent(this.savedId, text, this.code, this.language, {
        dataReferences,
        reportId:
          includeReport && this.result ? this.activeBacktestReportId || undefined : undefined,
      });
      if (selection !== this.chatSelection) {
        return;
      }
      await this.turnStream.attach(turnId, this.turnHandlers()); // resolves after the terminal event
    } catch (e) {
      if (selection !== this.chatSelection) {
        return;
      }
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage(
            'assistant',
            i18n.t('strategy:storeError', {
              message: e instanceof Error ? e.message : i18n.t('strategy:storeRequestFailed'),
            }),
          ),
        ];
      });
    } finally {
      if (selection === this.chatSelection) {
        runInAction(() => {
          this.sending = false;
        });
      }
    }
  }

  /**
   * 明确接受后使用服务端保存的代码；请求期间的本地编辑不被覆盖。
   *
   * Adopt server-saved code only after acceptance, preserving edits made while the request was pending.
   */
  public async acceptCodeChange(proposal: CodeChangeProposalV1) {
    if (
      this.codeChangeLoader.loading ||
      proposal.surface !== 'strategy' ||
      proposal.entityId !== this.savedId ||
      this.code !== proposal.beforeCode ||
      this.language !== proposal.language
    ) {
      return;
    }
    const selection = this.chatSelection;
    const beforeCode = this.code;
    const accepted = await this.codeChangeLoader.run({
      entityId: proposal.entityId,
      proposalId: proposal.id,
      beforeCode,
    });
    if (selection !== this.chatSelection || this.savedId !== proposal.entityId) {
      return;
    }

    runInAction(() => {
      this.chatMessages = this.chatMessages.map((message) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.type === 'code_change' && part.proposal.id === accepted.id
            ? { type: 'code_change' as const, proposal: accepted }
            : part,
        ),
      }));
      if (this.code === beforeCode) {
        this.code = accepted.afterCode;
      }
      this.result = null;
    });
  }

  /**
   * 构造发送与刷新重连共用的终态事件处理。
   *
   * Terminal-event handlers shared by sendAgent and the refresh reattach.
   */
  private turnHandlers(): AgentTurnHandlers {
    const strategyId = this.savedId;
    const selection = this.chatSelection;
    return {
      onEmbeddedAnalysis: (part, turnId) => {
        if (this.savedId !== strategyId || selection !== this.chatSelection) {
          return;
        }
        runInAction(() => {
          this.chatMessages = retainEmbeddedPart(this.chatMessages, part, turnId);
        });
      },
      onDone: (done) => {
        if (this.savedId !== strategyId || selection !== this.chatSelection) {
          return;
        }
        runInAction(() => {
          // toolTrace rides along for display only (the server persisted the message without it).
          this.chatMessages = upsertAssistantMessage(this.chatMessages, {
            role: 'assistant',
            parts: done.parts,
            turnId: done.turnId,
            toolTrace: done.toolTrace,
          } as ChatMessage);
        });
      },
      onError: (message) => {
        if (this.savedId !== strategyId || selection !== this.chatSelection) {
          return;
        }
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('strategy:storeError', { message })),
          ];
        });
      },
      onCancelled: () => {
        if (this.savedId !== strategyId || selection !== this.chatSelection) {
          return;
        }
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('strategy:storeTurnStopped')),
          ];
        });
      },
    };
  }

  /**
   * 按策略身份查找活动对话并重新订阅，通过快照恢复内容。
   *
   * Refresh reattach: if this strategy has a live turn, subscribe (snapshot replays what we missed).
   */
  private async reattachTurn() {
    if (!this.savedId) {
      return;
    }
    runInAction(() => (this.sending = true));
    const selection = this.chatSelection;
    const turnId = await this.turnStream.findRunning(`strategy:${this.savedId}`);
    if (selection !== this.chatSelection) {
      return;
    }
    if (turnId) {
      await this.turnStream.attach(turnId, this.turnHandlers());
    }
    if (selection === this.chatSelection) {
      runInAction(() => (this.sending = false));
    } // resolved at the terminal event (or no live turn)
  }

  /**
   * 首次提示或手写策略首次运行前先创建持久化策略记录。
   *
   * Create the strategy row if it doesn't exist yet (first Agent prompt, or a first run of a
   * hand-written strategy). The server names it from the prompt when given, else from the code. The
   * baseline is left empty so a never-run strategy is dirty (→ runnable). Best-effort.
   */
  private async ensureStrategy(namePrompt?: string) {
    if (this.savedId) {
      return;
    }
    try {
      // No messages in the create payload — the turn runner appends the user message server-side.
      const selection = this.chatSelection;
      const meta = await createStrategy(this.config, namePrompt);
      if (selection !== this.chatSelection) {
        return;
      }
      runInAction(() => {
        this.savedId = meta.id;
        this.name = meta.name; // the server generates and de-dupes the name
        this.persistedConfig = this.configKey(); // we just persisted this config (nothing to lose yet)
      });
      pushRecent(meta.id);
      void this.savedLoader.run();
    } catch {
      /* best-effort — a later run retries via ensureStrategy */
    }
  }

  /**
   * 重置为新的空策略骨架及未运行编辑基线。
   *
   * Start fresh: a blank skeleton strategy. Empty baseline → dirty → Run-backtest enabled.
   */
  public newStrategy(language: StrategyLanguage = 'typescript') {
    this.chatSelection += 1;
    this.turnStream.detach();
    runInAction(() => {
      this.sending = false;
    });
    runInAction(() => {
      this.name = '';
      this.language = language;
      this.code = language === 'python' ? DEFAULT_PYTHON_CODE : DEFAULT_CODE;
      this.researchHandoff = null;
      this.sourceResearchExecution = null;
      this.cost = { ...DEFAULT_BACKTEST_COST };
      this.nlText = '';
      this.chatMessages = [];
      this.result = null;
      this.activeBacktestReportId = null;
      this.error = null;
      this.logLines = [];
      this.scanReport = null;
      this.scanLogLines = [];
      this.scanError = null;
      this.deployments = [];
      this.deploymentError = null;
      this.savedId = null;
      this.savedConfig = ''; // never run → dirty (runnable)
      this.persistedConfig = this.configKey(); // pristine skeleton → not edited (no leave guard)
    });
    this.resetBenchmarks();
    this.scanPoller.stop();
    this.scanParametersLoader.reset();
    this.backtestHistoryLoader.reset();
    this.backtestReportLoader.reset();
    this.backtestComparisonLoader.reset();
    this.scanHistoryLoader.reset();
    this.scanReportLoader.reset();
    this.deploymentLoader.reset();
    this.deploymentActionLoader.reset();
  }

  /**
   * 将当前不可变报告提交为信号部署并刷新关联状态。
   *
   * Deploy the selected immutable report and refresh deployment state.
   */
  public async deploy() {
    if (
      !this.savedId ||
      !this.activeBacktestReportId ||
      !this.canDeployReport ||
      this.deploymentActionLoader.loading
    ) {
      return;
    }
    const strategyId = this.savedId;
    try {
      const deployment = await this.deploymentActionLoader.run({
        type: 'deploy',
        reportId: this.activeBacktestReportId,
      });
      if (this.savedId !== strategyId) {
        return;
      }
      runInAction(() => {
        this.deployments = [
          deployment,
          ...this.deployments.filter((candidate) => candidate.id !== deployment.id),
        ];
        this.deploymentError = null;
      });
    } catch (error) {
      if (this.savedId !== strategyId) {
        return;
      }
      runInAction(() => {
        this.deploymentError =
          error instanceof Error ? error.message : i18n.t('strategy:deploymentFailed');
      });
    }
  }

  /**
   * 暂停已选部署并刷新状态，保持当前报告关联。
   *
   * Pause the selected deployment and refresh its state.
   */
  public async pauseDeployment() {
    if (!this.deployment || this.deploymentActionLoader.loading) {
      return;
    }
    const strategyId = this.savedId;
    try {
      const paused = await this.deploymentActionLoader.run({
        type: 'pause',
        deploymentId: this.deployment.id,
      });
      if (this.savedId !== strategyId) {
        return;
      }
      runInAction(() => {
        this.deployments = this.deployments.map((deployment) =>
          deployment.id === paused.id ? paused : deployment,
        );
        this.deploymentError = null;
      });
    } catch (error) {
      if (this.savedId !== strategyId) {
        return;
      }
      runInAction(() => {
        this.deploymentError =
          error instanceof Error ? error.message : i18n.t('strategy:deploymentPauseFailed');
      });
    }
  }

  /**
   * 提交回测作为配置持久化点，记录新报告身份并启动后台进度轮询。
   *
   * Run a backtest. This is the commit point: it persists the current config (code/range/capital) onto
   * the strategy, replaces the shown result with the new run, and re-derives the name from the code.
   */
  public async run() {
    await this.ensureStrategy(); // create the row if this is a hand-written strategy that never talked to the agent
    if (!this.savedId) {
      runInAction(() => (this.error = i18n.t('strategy:storeSaveFailedNoBacktest')));
      return;
    }
    let jobId: string;
    let reportId: string;
    try {
      ({ jobId, reportId } = await submitBacktest(this.config, this.savedId));
    } catch (e) {
      runInAction(
        () => (this.error = e instanceof Error ? e.message : i18n.t('strategy:storeSubmitFailed')),
      );
      return;
    }
    // The response confirms that the server committed this config and created its Job atomically.
    this.markSaved();
    runInAction(() => {
      this.result = null;
      this.activeBacktestReportId = reportId;
      this.logLines = [];
      this.error = null;
      this.queuePosition = null;
    });
    this.resetBenchmarks();
    void this.savedLoader.run();
    this.startPolling(jobId);
  }

  /**
   * 根据保存的 jobId 重连仍在运行的回测，不重复提交。
   *
   * Re-attach to a still-running backtest (jobId from localStorage) without resubmitting.
   */
  public resume(jobId: string) {
    runInAction(() => {
      this.logLines = [];
      this.result = null;
      this.error = null;
      this.queuePosition = null;
    });
    this.startPolling(jobId);
  }

  /**
   * 将 Worker 增量日志追加到当前回测输出。
   *
   * Append log lines streamed from the backtest worker.
   */
  public appendLogs(lines: LogLine[]) {
    runInAction(() => {
      this.logLines = [...this.logLines, ...lines];
    });
  }

  /**
   * 恢复已保存配置到编辑器，调用方另行管理结果和报告身份。
   *
   * Reflect a full saved BacktestConfig back into the editor (name + range/capital + code). The caller
   * (openSaved) sets the `dirty` baseline, since it depends on whether a run result exists.
   */
  public applyConfig(config: BacktestConfig) {
    runInAction(() => {
      this.name = config.name;
      this.start = config.start;
      this.end = config.end;
      this.initialCash = config.initialCash;
      this.cost = { ...DEFAULT_BACKTEST_COST, ...config.cost };
      this.language = config.language ?? 'typescript';
      this.code = config.code;
    });
  }

  /**
   * 序列化影响运行的配置以判断 dirty，名称不参与。
   *
   * Serialize the RUN-relevant config for `dirty` (excludes name — a rename doesn't invalidate a run).
   */
  private configKey(): string {
    return JSON.stringify({
      start: this.start,
      end: this.end,
      initialCash: this.initialCash,
      cost: this.cost,
      language: this.language,
      runtimeVersion: this.language === 'python' ? 'py-v1' : 'ts-v1',
      code: this.code,
    });
  }

  public changeLanguage(language: StrategyLanguage) {
    if (language === this.language) {
      return;
    }
    runInAction(() => {
      this.language = language;
      this.code = language === 'python' ? DEFAULT_PYTHON_CODE : DEFAULT_CODE;
      this.scanReport = null;
      this.scanError = null;
    });
    this.scanParametersLoader.reset();
    this.scanReportLoader.reset();
  }

  /**
   * 将已提交配置设为运行与持久化基线，重置两种变更判断。
   *
   * A run committed the current config: it's both the new run baseline (dirty) and persisted (edited).
   */
  private markSaved() {
    runInAction(() => {
      this.savedConfig = this.persistedConfig = this.configKey();
    });
  }

  /**
   * 打开已保存策略、恢复配置和最近结果，并重连活动回测。
   *
   * Reopen a saved strategy: load its config + last result, and re-attach to a running backtest if one
   * is still in flight for it (so a refresh continues streaming logs instead of losing the run).
   */
  public async openSaved(id: string, reportId?: string) {
    const selection = ++this.chatSelection;
    this.turnStream.detach();
    runInAction(() => {
      this.sending = false;
    });
    this.deploymentActionLoader.reset();
    this.backtestHistoryLoader.abort();
    this.backtestHistoryLoader.reset();
    this.backtestReportLoader.reset();
    this.backtestComparisonLoader.reset();
    let s;
    try {
      s = await getStrategy(id);
    } catch {
      return; // strategy gone (deleted)
    }
    if (selection !== this.chatSelection) {
      return;
    }
    this.applyConfig(s.config);
    runInAction(() => {
      this.result = s.lastResult ?? null;
      this.activeBacktestReportId = null;
      this.chatMessages = (s.messages ?? []).map(normalizeChatMessage); // restore (upgrades legacy rows)
      this.researchHandoff = s.researchHandoff ?? null;
      this.sourceResearchExecution = s.sourceResearchExecution ?? null;
      this.error = null;
      this.savedId = id;
      // A strategy with a result → its config IS the last-run config (not dirty); one never run stays
      // dirty (empty run-baseline) so Run-backtest is enabled. Either way the loaded config IS what's in the
      // DB → not edited (opening it doesn't false-warn the leave guard).
      this.savedConfig = s.lastResult ? this.configKey() : '';
      this.persistedConfig = this.configKey();
      this.scanReport = null;
      this.scanLogLines = [];
      this.scanError = null;
      this.scanQueuePosition = null;
      this.deployments = [];
      this.deploymentError = null;
    });
    this.loadBenchmarks(this.result);
    pushRecent(id); // record the visit → hero Recent-visits + auto-open on next entry
    void this.reattachTurn(); // a live agent turn for this strategy? re-subscribe (snapshot replays)
    void this.backtestHistoryLoader.run(id).then((reports) => {
      if (this.savedId === id) {
        runInAction(() => {
          this.activeBacktestReportId = reports[0]?.id ?? null;
        });
        const selectedReportId =
          reports.find((report) => report.id === reportId)?.id ?? reports[0]?.id;
        if (selectedReportId && (reportId || !this.result)) {
          // Draft saves may clear lastResult, but their historical reports remain deployable.
          runInAction(() => {
            this.activeBacktestReportId = null;
          });
          void this.viewBacktestReport(selectedReportId);
        }
      }
    });
    void this.scanHistoryLoader.run(id).then((reports) => {
      if (reports[0] && !this.scanReport) {
        void this.loadScanReport(reports[0].id);
      }
    });
    void this.deploymentLoader.run(id).then((deployments) => {
      if (this.savedId === id) {
        runInAction(() => {
          this.deployments = deployments;
          this.deploymentError = null;
        });
      }
    });
    // Re-attach to a still-running backtest (found server-side by strategyId — no localStorage, works
    // cross-client) so a refresh keeps streaming logs instead of losing the run.
    try {
      const activeJob = await findActiveBacktestJob(id);
      if (activeJob) {
        this.resume(activeJob.jobId);
      }
    } catch {
      /* none running / expired — the saved lastResult stays shown */
    }
    try {
      const activeJob = await findActiveStrategyScanJob(id);
      if (activeJob) {
        this.startScanPolling(activeJob.jobId, activeJob.reportId);
      }
    } catch {
      /* none running */
    }
  }

  /**
   * 删除已保存策略后刷新列表。
   *
   * Delete a saved strategy, then refresh the list.
   */
  public removeSaved(id: string) {
    removeRecent(id);
    void deleteStrategy(id).then(() => this.savedLoader.run());
  }

  public loadSavedList() {
    void this.savedLoader.run();
  }

  private startPolling(jobId: string) {
    this.jobId = jobId;
    this.since = 0;
    this.backtestPoller.start();
  }

  private startScanPolling(jobId: string, reportId: string) {
    this.scanJobId = jobId;
    this.scanReportId = reportId;
    this.scanSince = 0;
    runInAction(() => {
      this.scanLogLines = [];
      this.scanError = null;
    });
    this.scanPoller.start();
  }

  /**
   * 轮询扫描任务并在终态后加载持久化报告。
   *
   * Poll a scan job and load its persisted report at completion.
   */
  private async pollScanOnce(): Promise<false | void> {
    try {
      const job = await pollStrategyScan(this.scanJobId!, this.scanSince);
      runInAction(() => {
        this.scanQueuePosition = job.status === 'queued' ? (job.queuePosition ?? null) : null;
      });
      if (job.logs.length) {
        runInAction(() => {
          this.scanLogLines = [...this.scanLogLines, ...job.logs];
          this.scanSince = job.nextSince;
        });
      }
      if (job.status === 'done') {
        await this.loadScanReport(this.scanReportId!);
        if (this.savedId) {
          void this.scanHistoryLoader.run(this.savedId);
        }
        return false;
      }
      if (job.status === 'error' || job.status === 'stale') {
        runInAction(() => {
          this.scanError =
            job.status === 'stale'
              ? i18n.t('strategy:scanInterrupted')
              : job.error || i18n.t('strategy:scanFailed');
        });
        void this.loadScanReport(this.scanReportId!);
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * 单次轮询追加回测日志，完成、失败或过期时返回 false 停止。
   *
   * One poll tick — append new logs; return false to stop the poller (done / error / expired).
   */
  private async pollOnce(): Promise<false | void> {
    try {
      const job = await pollBacktest(this.jobId!, this.since);
      runInAction(() => {
        this.queuePosition = job.status === 'queued' ? (job.queuePosition ?? null) : null;
      });
      if (job.logs.length) {
        this.appendLogs(job.logs);
        this.since = job.nextSince;
      }
      if (job.status === 'done') {
        // The immutable report is complete; Strategy.lastResult mirrors it for the existing Strategy UI.
        let result: BacktestSummary | null = null;
        let name = this.name;
        if (this.savedId) {
          try {
            const s = await getStrategy(this.savedId);
            result = (s.lastResult as BacktestSummary) ?? null;
            name = s.name;
          } catch {
            /* strategy fetch failed — leave the last shown result */
          }
        }
        runInAction(() => {
          this.result = result;
          this.name = name;
          this.activeBacktestReportId = job.backtestReportId ?? this.activeBacktestReportId;
        });
        this.loadBenchmarks(result);
        void this.savedLoader.run();
        if (this.savedId) {
          void this.backtestHistoryLoader.run(this.savedId);
        }
        return false;
      }
      if (job.status === 'error' || job.status === 'stale') {
        runInAction(() => {
          this.error =
            job.status === 'stale'
              ? i18n.t('strategy:storeBacktestInterrupted')
              : job.error || i18n.t('strategy:storeBacktestFailed');
        });
        return false;
      }
    } catch {
      // job gone (server restart / expired) / network — stop; the saved last result (if any) stays shown.
      return false;
    }
  }

  private loadBenchmarks(result: BacktestSummary | null) {
    const start = result?.nav?.[0]?.date;
    const end = result?.nav?.at(-1)?.date;
    if (!start || !end) {
      this.resetBenchmarks();
      return;
    }

    void this.benchmarkLoader.run({ start, end }).catch(() => {});
  }

  /**
   * 读取明确历史报告并更新查看身份，不覆盖当前编辑配置。
   *
   * Load an explicit historical report and update viewed identity independently of editing.
   */
  public async viewBacktestReport(reportId: string) {
    if (reportId === this.activeBacktestReportId || !this.savedId) {
      return;
    }
    const detail = await this.backtestReportLoader.run(reportId);
    if (detail.strategyId !== this.savedId) {
      return;
    }
    runInAction(() => {
      this.activeBacktestReportId = detail.id;
      this.deploymentError = null;
      this.result = detail.result;
      this.error = null;
    });
    this.loadBenchmarks(detail.result);
  }

  /**
   * 加载比较报告并校验当前选择，避免旧请求覆盖新比较。
   *
   * Load a comparison report under selection guards against stale requests.
   */
  public async loadBacktestComparison(reportId: string) {
    if (!this.savedId || reportId === this.activeBacktestReportId) {
      return null;
    }
    const strategyId = this.savedId;
    const detail = await this.backtestComparisonLoader.run(reportId);
    if (detail.strategyId !== strategyId || this.savedId !== strategyId) {
      this.resetBacktestComparison();
      return null;
    }

    return detail;
  }

  public resetBacktestComparison() {
    this.backtestComparisonLoader.abort();
    this.backtestComparisonLoader.reset();
  }

  private resetBenchmarks() {
    this.benchmarkLoader.abort();
    this.benchmarkLoader.reset();
  }
}

// —— helpers ——

const POLL_INTERVAL_MS = 1500;
