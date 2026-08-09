import { computed, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  textMessage,
  type BacktestConfig,
  type BacktestSummary,
  type ChatMessage,
  type CostConfig,
  type FactorMeta,
  type LogLine,
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
import { QueryCardResults } from '@src/components/query-card-model';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import {
  createStrategy,
  deployStrategy,
  deleteStrategy,
  findBacktestRunningJob,
  findRunningStrategyScan,
  getFactorComposite,
  getStrategy,
  getCurrentStrategyDeployment,
  getStrategyScanReport,
  fetchIndexSeries,
  inspectStrategyParameters,
  getCustomFactor,
  getFactorCatalog,
  getFactorReport,
  listStrategyScans,
  listStrategies,
  pollBacktest,
  pollStrategyScan,
  pauseStrategyDeployment,
  sendAgent,
  submitBacktest,
  submitStrategyScan,
} from '@src/api/client';
import { DEFAULT_CODE, DEFAULT_PYTHON_CODE } from './default-strategy';
import { BENCHMARKS, type BenchmarkSeries } from './benchmarks';
import { pushRecent, readRecents, removeRecent } from './recents';
import { PANEL_ASSET_IDS } from '../factor/panel-universe';

type LabSetupParams = { id?: string; isNew?: boolean; factorKey?: string };
type DeploymentAction =
  | { type: 'deploy'; strategyId: string }
  | { type: 'pause'; deploymentId: string };

/**
 * Backtest workbench store — code-first. Persistence model (per the agent workflow):
 *  - a strategy row is CREATED up front on the first Agent prompt (LLM-named from the request), so the
 *    conversation has something to attach to;
 *  - `messages` save in real time (every Agent turn, by id);
 *  - `config` (code / range / capital) + `name` persist ONLY on a run — the name is re-derived from the
 *    code each run (the model keeps it when it still fits). So the editor's code/params are a working
 *    state that only commits when you Run backtest; an unrun edit is lost on refresh (by design).
 * `dirty` = the run-relevant config changed since the last run → gates the Run-backtest button + the "result
 * is stale" behavior. The result is replaced only by a run, never cleared by editing code.
 */
export class LabStore extends BaseStore<LabSetupParams> {
  public name = ''; // LLM-derived name; regenerated from the code on each run (the strategy name, not the code's own)
  public start = '20200101';
  public end = '20241231';
  public initialCash = 1_000_000;
  public cost: CostConfig = { slippageBps: 2, impactCoef: 0.1 };
  public code = DEFAULT_CODE;
  public language: StrategyLanguage = 'typescript';

  public nlText = ''; // the Agent chat draft / hero prompt

  public chatMessages: ChatMessage[] = []; // the Agent conversation for this strategy (persisted per strategy)
  public sending = false; // an Agent turn is in flight
  public cardResults = new QueryCardResults(); // fresh results for the conversation's query cards
  public turnStream = new AgentTurnStream(); // the in-flight turn's SSE mirror (pending bubble)

  public logLines: LogLine[] = []; // live backtest progress (streamed via polling), tagged system/user
  public result: BacktestSummary | null = null; // a finished run OR the saved last-result on reopen
  public error: string | null = null; // backtest failure message
  public savedId: string | null = null; // this strategy's DB id (for the URL)
  public savedConfig = ''; // run-relevant config at the LAST RUN (or '' if never run) — baseline for `dirty`
  public persistedConfig = ''; // run-relevant config as PERSISTED in the DB (create/run/open) — baseline for `edited`
  public initializing = false; // opening the initial strategy on mount — render a neutral loader, not the hero
  public scanReport: StrategyScanReport | null = null;
  public scanLogLines: LogLine[] = [];
  public scanError: string | null = null;
  public deployment: StrategyDeployment | null = null;
  public deploymentError: string | null = null;

  private jobId: string | null = null; // polling cursor for the current backtest
  private since = 0;
  private scanReportId: string | null = null;
  private scanSince = 0;

  public backtestPoller = new PollingModel();
  public scanPoller = new PollingModel();
  public savedLoader = new LoaderModel<StrategyCard[]>(); // My strategies / History cards
  public benchmarkLoader = new LoaderModel<BenchmarkSeries>();
  public scanParametersLoader = new LoaderModel<Record<string, StrategyParamValue>>();
  public scanHistoryLoader = new LoaderModel<StrategyScanReportSummary[]>();
  public scanReportLoader = new LoaderModel<StrategyScanReport>();
  public deploymentLoader = new LoaderModel<StrategyDeployment | null>();
  public deploymentActionLoader = new LoaderModel<StrategyDeployment>();
  public factorLoader = new LoaderModel<{ factor: FactorMeta; assets: string[] } | null>();

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
      nlText: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      logLines: observable.ref,
      result: observable.ref,
      error: observable.ref,
      savedId: observable.ref,
      savedConfig: observable.ref,
      persistedConfig: observable.ref,
      initializing: observable.ref,
      scanReport: observable.ref,
      scanLogLines: observable.ref,
      scanError: observable.ref,
      deployment: observable.ref,
      deploymentError: observable.ref,
      config: computed,
      dirty: computed,
      edited: computed,
      isFresh: computed,
      deploymentCurrent: computed,
    });
  }

  public setup(params: LabSetupParams) {
    super.setup(params);
    this.backtestPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollOnce() });
    this.scanPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollScanOnce() });
    this.savedLoader.setup({ request: () => listStrategies() });
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
      request: (strategyId: string) => listStrategyScans(strategyId),
    });
    this.scanReportLoader.setup({ request: (reportId: string) => getStrategyScanReport(reportId) });
    this.deploymentLoader.setup({
      request: async (strategyId: string) =>
        (await getCurrentStrategyDeployment(strategyId)).deployment,
    });
    this.deploymentActionLoader.setup({
      request: (action: DeploymentAction) =>
        action.type === 'deploy'
          ? deployStrategy(action.strategyId)
          : pauseStrategyDeployment(action.deploymentId),
    });
    this.factorLoader.setup({
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
    this.registCleaner(() => this.benchmarkLoader.cleanup());
    this.registCleaner(() => this.scanParametersLoader.cleanup());
    this.registCleaner(() => this.scanHistoryLoader.cleanup());
    this.registCleaner(() => this.scanReportLoader.cleanup());
    this.registCleaner(() => this.deploymentLoader.cleanup());
    this.registCleaner(() => this.deploymentActionLoader.cleanup());
    this.registCleaner(() => this.factorLoader.cleanup());
    this.registCleaner(() => this.turnStream.detach()); // drop the SSE subscription; the turn keeps running
    void this.savedLoader.run(); // prime My strategies (also feeds the hero's Recent-visits cards)
    // A fresh (never-run) strategy: empty run-baseline → dirty → Run-backtest enabled; but the pristine
    // skeleton IS the "persisted" state (nothing to lose) → not edited → no leave guard.
    this.savedConfig = '';
    this.persistedConfig = this.configKey();
    if (params.isNew && params.factorKey) {
      void this.prefillFactor(params.factorKey).catch((error): void => {
        console.error('Failed to prefill factor in Strategy Lab', error);
      });
    }
    // Resolve the initial view: `?new=1` forces the blank hero; else an explicit ?id; else the
    // most-recently-opened strategy (so re-entering /lab lands on your last work, not the blank hero);
    // else the blank starter. When we WILL open one, set `initializing` synchronously so the first paint
    // is a neutral loader — not the hero / empty workbench flashing before openSaved resolves.
    const initialId = params.isNew ? '' : params.id || readRecents()[0];
    if (initialId) {
      this.initializing = true;
      void this.openSaved(initialId).finally(() => runInAction(() => (this.initializing = false)));
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
          ? 'lab:factorPanelStarterPrompt'
          : isTimeSeries
            ? 'lab:factorTimeSeriesStarterPrompt'
            : 'lab:factorStarterPrompt',
        {
          name: loaded.factor.label,
          key: loaded.factor.strategyKey,
          assets: loaded.assets.join('、'),
        },
      );
    });
  }

  /** True while a backtest is running (drives the loading state + progress log). */
  public get running(): boolean {
    return this.backtestPoller.running;
  }

  /** Untouched starter strategy (no saved id, default code, no run, no chat) → show the prompt-first hero. */
  public get isFresh(): boolean {
    return (
      !this.savedId && !this.result && this.code === DEFAULT_CODE && this.chatMessages.length === 0
    );
  }

  /** The run-relevant config (range/capital/code — NOT name) changed since the last run. Gates Run-backtest:
   * a never-run strategy has an empty baseline → dirty → runnable; a fresh run resets the baseline. */
  public get dirty(): boolean {
    return this.configKey() !== this.savedConfig;
  }

  /** The code/params differ from what's PERSISTED in the DB — i.e. there are unrun edits that leaving
   * would lose. Gates the leave guard (New / switch strategy / refresh). A just-opened strategy is NOT edited (even
   * if never run → dirty), so opening one doesn't false-warn. */
  public get edited(): boolean {
    return this.configKey() !== this.persistedConfig;
  }

  /** The active deployment freezes exactly the currently committed run configuration. */
  public get deploymentCurrent(): boolean {
    if (!this.deployment) {
      return false;
    }
    const config = this.deployment.config;
    return (
      JSON.stringify({
        start: config.start,
        end: config.end,
        initialCash: config.initialCash,
        cost: config.cost,
        code: config.code,
        language: config.language ?? 'typescript',
        runtimeVersion: config.runtimeVersion ?? 'ts-v1',
      }) === this.configKey()
    );
  }

  /** Range/capital + the strategy code → a runnable BacktestConfig. */
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

  public setField<K extends keyof LabStore>(key: K, value: LabStore[K]) {
    runInAction(() => {
      (this as LabStore)[key] = value;
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
      runInAction(() => (this.scanError = i18n.t('lab:storeSaveFailedNoBacktest')));
      return;
    }

    try {
      const { reportId } = await submitStrategyScan(this.savedId, this.config, spec);
      runInAction(() => {
        this.scanReport = null;
        this.scanLogLines = [];
        this.scanError = null;
      });
      this.startScanPolling(reportId);
      void this.scanHistoryLoader.run(this.savedId);
    } catch (error) {
      runInAction(() => {
        this.scanError = error instanceof Error ? error.message : i18n.t('lab:scanSubmitFailed');
      });
    }
  }

  public async loadScanReport(reportId: string) {
    try {
      const report = await this.scanReportLoader.run(reportId);
      runInAction(() => {
        this.scanReport = report;
        this.scanError =
          report.error ?? (report.status === 'stale' ? i18n.t('lab:scanInterrupted') : null);
      });
    } catch (error) {
      runInAction(() => {
        this.scanError = error instanceof Error ? error.message : i18n.t('lab:scanLoadFailed');
      });
    }
  }

  /** One Agent turn — streamed. Append the user message locally, ensure the strategy exists (the
   * first prompt creates it, LLM-named from that request), START the turn (server persists both the
   * user message and the reply onto the strategy row), then subscribe to its SSE stream; the reply
   * lands via turnHandlers. Code is NOT persisted here (only a run commits config). */
  public async sendAgent(message: string) {
    const text = message.trim();
    if (!text || this.sending) {
      return;
    }
    runInAction(() => {
      this.chatMessages = [...this.chatMessages, textMessage('user', text)];
      this.sending = true;
      this.nlText = '';
    });
    // First prompt → create the strategy so the conversation has a home (named from this request).
    await this.ensureStrategy(text);
    if (!this.savedId) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage('assistant', i18n.t('lab:storeChatStartFailed')),
        ];
        this.sending = false;
      });
      return;
    }
    try {
      const { turnId } = await sendAgent(this.savedId, text, this.code, this.language);
      await this.turnStream.attach(turnId, this.turnHandlers()); // resolves after the terminal event
    } catch (e) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage(
            'assistant',
            i18n.t('lab:storeError', {
              message: e instanceof Error ? e.message : i18n.t('lab:storeRequestFailed'),
            }),
          ),
        ];
      });
    } finally {
      runInAction(() => {
        this.sending = false;
      });
    }
  }

  /** Terminal-event handlers shared by sendAgent and the refresh reattach. */
  private turnHandlers(): AgentTurnHandlers {
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
            this.code = done.code; // dirty → runnable; the shown result stays until the next run
          }
        });
      },
      onError: (message) => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('lab:storeError', { message })),
          ];
        });
      },
      onCancelled: () => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('lab:storeTurnStopped')),
          ];
        });
      },
    };
  }

  /** Refresh reattach: if this strategy has a live turn, subscribe (snapshot replays what we missed). */
  private async reattachTurn() {
    if (!this.savedId) {
      return;
    }
    runInAction(() => (this.sending = true));
    await this.turnStream.attachRunning(`strategy:${this.savedId}`, this.turnHandlers());
    runInAction(() => (this.sending = false)); // resolved at the terminal event (or no live turn)
  }

  /** Create the strategy row if it doesn't exist yet (first Agent prompt, or a first run of a
   * hand-written strategy). The server names it from the prompt when given, else from the code. The
   * baseline is left empty so a never-run strategy is dirty (→ runnable). Best-effort. */
  private async ensureStrategy(namePrompt?: string) {
    if (this.savedId) {
      return;
    }
    try {
      // No messages in the create payload — the turn runner appends the user message server-side.
      const meta = await createStrategy(this.config, namePrompt);
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

  /** Start fresh: a blank skeleton strategy. Empty baseline → dirty → Run-backtest enabled. */
  public newStrategy(language: StrategyLanguage = 'typescript') {
    runInAction(() => {
      this.name = '';
      this.language = language;
      this.code = language === 'python' ? DEFAULT_PYTHON_CODE : DEFAULT_CODE;
      this.cost = { slippageBps: 2, impactCoef: 0.1 };
      this.nlText = '';
      this.chatMessages = [];
      this.result = null;
      this.error = null;
      this.logLines = [];
      this.scanReport = null;
      this.scanLogLines = [];
      this.scanError = null;
      this.deployment = null;
      this.deploymentError = null;
      this.savedId = null;
      this.savedConfig = ''; // never run → dirty (runnable)
      this.persistedConfig = this.configKey(); // pristine skeleton → not edited (no leave guard)
    });
    this.resetBenchmarks();
    this.scanPoller.stop();
    this.scanParametersLoader.reset();
    this.scanHistoryLoader.reset();
    this.scanReportLoader.reset();
    this.deploymentLoader.reset();
    this.deploymentActionLoader.reset();
  }

  public async deploy() {
    if (!this.savedId || !this.result || this.dirty) {
      return;
    }
    try {
      const deployment = await this.deploymentActionLoader.run({
        type: 'deploy',
        strategyId: this.savedId,
      });
      runInAction(() => {
        this.deployment = deployment;
        this.deploymentError = null;
      });
    } catch (error) {
      runInAction(() => {
        this.deploymentError =
          error instanceof Error ? error.message : i18n.t('lab:deploymentFailed');
      });
    }
  }

  public async pauseDeployment() {
    if (!this.deployment) {
      return;
    }
    try {
      await this.deploymentActionLoader.run({
        type: 'pause',
        deploymentId: this.deployment.id,
      });
      runInAction(() => {
        this.deployment = null;
        this.deploymentError = null;
      });
    } catch (error) {
      runInAction(() => {
        this.deploymentError =
          error instanceof Error ? error.message : i18n.t('lab:deploymentPauseFailed');
      });
    }
  }

  /** Run a backtest. This is the commit point: it persists the current config (code/range/capital) onto
   * the strategy, replaces the shown result with the new run, and re-derives the name from the code. */
  public async run() {
    await this.ensureStrategy(); // create the row if this is a hand-written strategy that never talked to the agent
    if (!this.savedId) {
      runInAction(() => (this.error = i18n.t('lab:storeSaveFailedNoBacktest')));
      return;
    }
    let jobId: string;
    try {
      ({ jobId } = await submitBacktest(this.config, this.savedId));
    } catch (e) {
      runInAction(
        () => (this.error = e instanceof Error ? e.message : i18n.t('lab:storeSubmitFailed')),
      );
      return;
    }
    // The response confirms that the server committed this config and created its Job atomically.
    this.markSaved();
    runInAction(() => {
      this.result = null;
      this.logLines = [];
      this.error = null;
    });
    this.resetBenchmarks();
    void this.savedLoader.run();
    this.startPolling(jobId);
  }

  /** Re-attach to a still-running backtest (jobId from localStorage) without resubmitting. */
  public resume(jobId: string) {
    runInAction(() => {
      this.logLines = [];
      this.result = null;
      this.error = null;
    });
    this.startPolling(jobId);
  }

  /** Append log lines streamed from the backtest worker. */
  public appendLogs(lines: LogLine[]) {
    runInAction(() => {
      this.logLines = [...this.logLines, ...lines];
    });
  }

  /** Reflect a full saved BacktestConfig back into the editor (name + range/capital + code). The caller
   * (openSaved) sets the `dirty` baseline, since it depends on whether a run result exists. */
  public applyConfig(config: BacktestConfig) {
    runInAction(() => {
      this.name = config.name;
      this.start = config.start;
      this.end = config.end;
      this.initialCash = config.initialCash;
      this.cost = { slippageBps: 2, impactCoef: 0.1, ...config.cost };
      this.language = config.language ?? 'typescript';
      this.code = config.code;
    });
  }

  /** Serialize the RUN-relevant config for `dirty` (excludes name — a rename doesn't invalidate a run). */
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

  /** A run committed the current config: it's both the new run baseline (dirty) and persisted (edited). */
  private markSaved() {
    runInAction(() => {
      this.savedConfig = this.persistedConfig = this.configKey();
    });
  }

  /** Reopen a saved strategy: load its config + last result, and re-attach to a running backtest if one
   * is still in flight for it (so a refresh continues streaming logs instead of losing the run). */
  public async openSaved(id: string) {
    this.deploymentActionLoader.reset();
    let s;
    try {
      s = await getStrategy(id);
    } catch {
      return; // strategy gone (deleted)
    }
    this.applyConfig(s.config);
    runInAction(() => {
      this.result = s.lastResult ?? null;
      this.chatMessages = (s.messages ?? []).map(normalizeChatMessage); // restore (upgrades legacy rows)
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
      this.deployment = null;
      this.deploymentError = null;
    });
    this.loadBenchmarks(this.result);
    pushRecent(id); // record the visit → hero Recent-visits + auto-open on next entry
    void this.reattachTurn(); // a live agent turn for this strategy? re-subscribe (snapshot replays)
    void this.scanHistoryLoader.run(id).then((reports) => {
      if (reports[0] && !this.scanReport) {
        void this.loadScanReport(reports[0].id);
      }
    });
    void this.deploymentLoader.run(id).then((deployment) => {
      if (this.savedId === id) {
        runInAction(() => {
          this.deployment = deployment;
          this.deploymentError = null;
        });
      }
    });
    // Re-attach to a still-running backtest (found server-side by strategyId — no localStorage, works
    // cross-client) so a refresh keeps streaming logs instead of losing the run.
    try {
      const { jobId } = await findBacktestRunningJob(id);
      if (jobId) {
        this.resume(jobId);
      }
    } catch {
      /* none running / expired — the saved lastResult stays shown */
    }
    try {
      const runningScan = await findRunningStrategyScan(id);
      if (runningScan.reportId) {
        this.startScanPolling(runningScan.reportId);
      }
    } catch {
      /* none running */
    }
  }

  /** Delete a saved strategy, then refresh the list. */
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

  private startScanPolling(reportId: string) {
    this.scanReportId = reportId;
    this.scanSince = 0;
    runInAction(() => {
      this.scanLogLines = [];
      this.scanError = null;
    });
    this.scanPoller.start();
  }

  private async pollScanOnce(): Promise<false | void> {
    try {
      const job = await pollStrategyScan(this.scanReportId!, this.scanSince);
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
              ? i18n.t('lab:scanInterrupted')
              : job.error || i18n.t('lab:scanFailed');
        });
        void this.loadScanReport(this.scanReportId!);
        return false;
      }
    } catch {
      return false;
    }
  }

  /** One poll tick — append new logs; return false to stop the poller (done / error / expired). */
  private async pollOnce(): Promise<false | void> {
    try {
      const job = await pollBacktest(this.jobId!, this.since);
      if (job.logs.length) {
        this.appendLogs(job.logs);
        this.since = job.nextSince;
      }
      if (job.status === 'done') {
        // Result lives on the strategy now (worker wrote lastResult) — fetch it.
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
        });
        this.loadBenchmarks(result);
        void this.savedLoader.run();
        return false;
      }
      if (job.status === 'error' || job.status === 'stale') {
        runInAction(() => {
          this.error =
            job.status === 'stale'
              ? i18n.t('lab:storeBacktestInterrupted')
              : job.error || i18n.t('lab:storeBacktestFailed');
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

  private resetBenchmarks() {
    this.benchmarkLoader.abort();
    this.benchmarkLoader.reset();
  }
}

// —— helpers ——

const POLL_INTERVAL_MS = 1500;
