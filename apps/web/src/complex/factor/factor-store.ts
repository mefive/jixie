import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  textMessage,
  type ChatMessage,
  type FactorMeta,
  type FactorReport,
  type FactorRun,
  type FactorFreq,
  type FactorCorrelation,
  type Neutral,
  type LogLine,
} from '@jixie/shared';
import i18n from '@src/i18n';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import { QueryCardResults } from '@src/components/query-card-model';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import {
  getFactorCatalog,
  getFactorRuns,
  getFactorAnalysis,
  runFactorAnalysis,
  pollFactorJob,
  findFactorRunningJob,
  getCustomFactor,
  createFactor,
  updateFactor,
  deleteCustomFactor,
  forkFactor,
  sendFactorAgent,
  factorQa,
  finalizeFactorKey,
  refreshFactorMetadata,
  runFactorCorrelation,
  getFactorCorrelation,
  findCorrelationRunningJob,
} from '@src/api/client';

// Initial state from the URL (?factor=&freq=&start=&end=&neutral=) — makes a report refresh-safe + shareable.
type FactorSetupParams = {
  factor?: string;
  freq?: FactorFreq;
  start?: string;
  end?: string;
  neutral?: Neutral;
};

const DEFAULT_START = '20150101';
const DEFAULT_END = '20261231';
const POLL_INTERVAL_MS = 800;

// Starter skeleton for a brand-new custom factor (what the middle editor shows before the Agent writes).
export const DEFAULT_FACTOR_CODE = `// 用左侧 Agent 描述你想要的因子，AI 写成代码；也可以直接改。
export default defineFactor({
  name: '新因子',
  // bar = 当天某只股票的横截面数据（估值/规模/流动性），返回因子值或 null
  compute: (bar) => (bar.peTtm && bar.peTtm > 0 ? 1 / bar.peTtm : null),
});
`;

/**
 * Factor research store — Agent-authored, IDE-style (mirrors the strategy workbench). Two kinds of factor:
 *  - preset (mom/ep/dv/…): a built-in formula → just pick it and run analysis; no code, no chat;
 *  - custom: Agent authors a `defineFactor` module. Created on the first Agent prompt (LLM-named),
 *    messages saved in real time, code/name committed only on an analysis run (which re-derives the name
 *    from the code). `edited` (code vs the persisted DB copy) gates the leave guard.
 * Analysis (deciles + Rank IC + long-short) is expensive, cached per (factor, freq, start, end).
 */
export class FactorStore extends BaseStore<FactorSetupParams> {
  public catalogLoader = new LoaderModel<FactorMeta[]>();
  public analysisLoader = new LoaderModel<FactorReport>();
  public runsLoader = new LoaderModel<FactorRun[]>();
  public keyLoader = new LoaderModel<{ id: string; key: string; strategyKey: string }>();
  public analysisPoller = new PollingModel();

  public selectedKey = ''; // preset key OR custom factor id — the analysis target
  public mode: 'preset' | 'custom' = 'preset';
  public code = ''; // the custom factor's defineFactor source (empty for presets)
  public persistedCode = ''; // code as persisted in the DB — baseline for `edited`
  public chatMessages: ChatMessage[] = []; // the Agent conversation for the current custom factor
  public cardResults = new QueryCardResults(); // fresh results for the conversation's query cards
  public turnStream = new AgentTurnStream(); // the in-flight turn's SSE mirror (pending bubble)
  public sending = false; // an Agent turn is in flight
  public nlText = ''; // the Agent chat draft
  public strategyKey = ''; // finalized custom:<key>; empty while the factor is a draft
  public keyDraft = ''; // LLM proposal or the user's edit before finalization
  public description = ''; // localized catalog summary generated from the current context

  private keyDraftEdited = false;

  public freq: FactorFreq = 'month';
  public neutral: Neutral = 'none'; // cross-sectional neutralization applied to the analysis (part of the cache key)
  public start = DEFAULT_START;
  public end = DEFAULT_END;
  public logs: LogLine[] = []; // streamed progress of the current run (job), tagged system/user
  public jobRunning = false; // a streamed analysis is in flight

  private jobId: string | null = null;
  private since = 0;

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
      mode: observable.ref,
      code: observable.ref,
      persistedCode: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      nlText: observable.ref,
      strategyKey: observable.ref,
      keyDraft: observable.ref,
      description: observable.ref,
      freq: observable.ref,
      neutral: observable.ref,
      start: observable.ref,
      end: observable.ref,
      logs: observable.ref,
      jobRunning: observable.ref,
      corrKeys: observable.ref,
      corrLogs: observable.ref,
      corrRunning: observable.ref,
      selected: computed,
      report: computed,
      correlation: computed,
      isCached: computed,
      edited: computed,
      qaMode: computed,
      setFreq: action,
      setNeutral: action,
      setStart: action,
      setEnd: action,
      setCorrKeys: action,
      setKeyDraft: action,
    });
  }

  public setup(params: FactorSetupParams) {
    super.setup(params);
    this.catalogLoader.setup({ request: () => getFactorCatalog() });
    this.runsLoader.setup({ request: () => getFactorRuns(this.selectedKey) });
    this.keyLoader.setup({ request: (key: string) => finalizeFactorKey(this.selectedKey, key) });
    this.analysisLoader.setup({
      request: (refresh = false) =>
        getFactorAnalysis(this.selectedKey, this.freq, this.start, this.end, this.neutral, refresh),
    });
    this.analysisPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollOnce() });
    this.correlationLoader.setup({
      request: () => getFactorCorrelation(this.corrKeys, this.freq, this.start, this.end),
    });
    this.correlationPoller.setup({
      interval: POLL_INTERVAL_MS,
      request: () => this.pollCorrelationOnce(),
    });
    this.registCleaner(() => this.catalogLoader.cleanup());
    this.registCleaner(() => this.runsLoader.cleanup());
    this.registCleaner(() => this.keyLoader.cleanup());
    this.registCleaner(() => this.analysisLoader.cleanup());
    this.registCleaner(() => this.analysisPoller.cleanup());
    this.registCleaner(() => this.correlationLoader.cleanup());
    this.registCleaner(() => this.correlationPoller.cleanup());
    this.registCleaner(() => this.turnStream.detach()); // drop the SSE subscription; the turn keeps running
    void this.catalogLoader.run();

    // Restore from the URL: preselect the factor (set selectedKey SYNCHRONOUSLY so the first paint shows
    // the analysis area, not the empty "pick a factor" placeholder — the report then loads under a delayed spinner), then
    // re-attach to a running job (refreshed mid-run) or load/run the window (refresh-safe / shareable).
    if (params.factor) {
      runInAction(() => {
        this.selectedKey = params.factor!;
        this.freq = params.freq ?? 'month';
        this.neutral = params.neutral ?? 'none';
        this.start = params.start ?? DEFAULT_START;
        this.end = params.end ?? DEFAULT_END;
      });
      void this.selectFactor(params.factor).then(() => this.restoreOrRun());
    }
  }

  public get selected(): FactorMeta | null {
    return this.catalogLoader.result?.find((f) => f.key === this.selectedKey) ?? null;
  }

  /** The current report only if it matches the selected factor (guards a stale render mid-switch). */
  public get report(): FactorReport | null {
    const r = this.analysisLoader.result;
    return r && r.factor === this.selectedKey ? r : null;
  }

  /** Whether the current (factor, freq, start, end) is already computed — drives the run/view label. */
  public get isCached(): boolean {
    return (this.runsLoader.result ?? []).some(
      (r) =>
        r.freq === this.freq &&
        (r.neutral ?? 'none') === this.neutral &&
        r.start === this.start &&
        r.end === this.end,
    );
  }

  /** A custom factor has unsaved code edits vs. the persisted DB copy → gates the leave guard. */
  public get edited(): boolean {
    return this.mode === 'custom' && this.code !== this.persistedCode;
  }

  /** A preset factor is selected → the Agent is in Q&A mode (answers questions, never writes code). */
  public get qaMode(): boolean {
    return this.mode === 'preset' && !!this.selectedKey;
  }

  public setFreq(v: FactorFreq) {
    runInAction(() => (this.freq = v));
  }
  public setNeutral(v: Neutral) {
    runInAction(() => (this.neutral = v));
  }
  public setStart(v: string) {
    runInAction(() => (this.start = v));
  }
  public setEnd(v: string) {
    runInAction(() => (this.end = v));
  }

  public setCode(v: string) {
    runInAction(() => (this.code = v));
  }
  public setNlText(v: string) {
    runInAction(() => (this.nlText = v));
  }

  public setKeyDraft(value: string) {
    this.keyDraft = value;
    this.keyDraftEdited = true;
  }

  /** Pick a factor from the factor library. A preset → readonly code + Q&A agent. A custom factor → load its
   * code + conversation into the editor/chat. Either way, auto-show its most-recent cached run. */
  public async selectFactor(key: string) {
    this.analysisPoller.stop(); // drop any in-flight job for the previous factor
    const meta = this.catalogLoader.result?.find((f) => f.key === key);
    const isCustom = meta?.kind === 'custom';
    runInAction(() => {
      this.selectedKey = key;
      this.mode = isCustom ? 'custom' : 'preset';
      this.jobRunning = false;
      this.logs = [];
      this.nlText = '';
      this.strategyKey = meta?.strategyKey ?? '';
      this.keyDraft = meta?.keyCandidate ?? meta?.strategyKey?.slice('custom:'.length) ?? '';
      this.description = meta?.description ?? '';
      this.keyDraftEdited = false;
      if (!isCustom) {
        this.code = '';
        this.persistedCode = '';
        this.chatMessages = [];
      }
    });
    try {
      // Presets are code rows too (seeded, readonly) — the same endpoint serves both kinds.
      const factor = await getCustomFactor(key);
      runInAction(() => {
        this.code = factor.code;
        this.persistedCode = factor.code;
        this.chatMessages = isCustom ? (factor.messages ?? []).map(normalizeChatMessage) : [];
        this.strategyKey = factor.strategyKey ?? '';
        this.keyDraft = factor.keyCandidate ?? factor.key ?? '';
        this.description = factor.description ?? '';
        this.keyDraftEdited = false;
      });
      if (isCustom) {
        void this.reattachTurn(); // a live agent turn for this factor? re-subscribe (snapshot replays)
      }
    } catch {
      /* factor gone (deleted elsewhere) — leave blank */
    }
    const runs = await this.runsLoader.run();
    if (runs.length) {
      await this.applyRun(runs[0]); // most recent (computedAt desc)
    } else {
      this.analysisLoader.reset(); // fresh factor — wait for an explicit run
    }
  }

  /** Copy the selected preset's (or own factor's) code into a NEW editable custom factor — the
   * "fork a variant, tweak params" research path. Selection jumps to the fresh copy. */
  public async forkSelected() {
    if (!this.selectedKey) {
      return;
    }
    const copy = await forkFactor(this.selectedKey);
    await this.catalogLoader.run();
    await this.selectFactor(copy.id);
  }

  /** Start authoring a brand-new custom factor (blank skeleton, ready for the Agent). */
  public newFactor() {
    this.analysisPoller.stop();
    runInAction(() => {
      this.selectedKey = '';
      this.mode = 'custom';
      this.code = DEFAULT_FACTOR_CODE;
      this.persistedCode = DEFAULT_FACTOR_CODE; // pristine skeleton → not edited
      this.chatMessages = [];
      this.nlText = '';
      this.strategyKey = '';
      this.keyDraft = '';
      this.description = '';
      this.keyDraftEdited = false;
      this.logs = [];
      this.jobRunning = false;
    });
    this.analysisLoader.reset();
  }

  /** One Agent turn: ensure the factor exists (the first prompt creates it, LLM-named from the prompt),
   * ask the server, append the reply, apply the returned code. Conversation saves in real time; the code
   * is NOT persisted here (only an analysis run commits it) and the analysis result is NOT cleared. */
  public async sendAgent(message: string) {
    const text = message.trim();
    if (!text || this.sending) {
      return;
    }
    // A preset is selected → the Agent is Q&A-only (no code, no factor). Answer and stop.
    if (this.qaMode) {
      return this.runQa(text);
    }
    // Continue editing only when the current selection is a SAVED custom factor; otherwise (nothing
    // selected) a chat starts a fresh custom factor — clear the selection so ensureFactor creates a new
    // row instead of attaching to nothing.
    const editingSaved = !!this.selectedKey && this.selected?.kind === 'custom';
    if (!editingSaved) {
      this.analysisLoader.reset();
      runInAction(() => {
        this.selectedKey = '';
        this.code = DEFAULT_FACTOR_CODE;
        this.persistedCode = DEFAULT_FACTOR_CODE;
        this.chatMessages = [];
      });
    }
    runInAction(() => {
      this.mode = 'custom';
      this.chatMessages = [...this.chatMessages, textMessage('user', text)];
      this.sending = true;
      this.nlText = '';
    });
    await this.ensureFactor();
    if (!this.selectedKey) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage(
            'assistant',
            i18n.t('factor:errorPrefix', { message: i18n.t('factor:saveFailed') }),
          ),
        ];
        this.sending = false;
      });
      return;
    }
    try {
      const { turnId } = await sendFactorAgent(this.selectedKey, text, this.code);
      await this.turnStream.attach(turnId, this.turnHandlers()); // resolves after the terminal event
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
            this.code = done.code; // editor updates; analysis result stays until the next run
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
    await this.turnStream.attachRunning(`factor:${this.selectedKey}`, this.turnHandlers());
    runInAction(() => (this.sending = false)); // resolved at the terminal event (or no live turn)
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

  /** Create the draft row if it doesn't exist yet; metadata arrives after the first successful turn. */
  private async ensureFactor() {
    if (this.selectedKey) {
      return;
    }
    try {
      // No messages in the create payload — the turn runner appends the user message server-side.
      const meta = await createFactor(i18n.t('factor:unnamedFactor'), this.code);
      runInAction(() => {
        this.selectedKey = meta.id;
        this.persistedCode = this.code; // just persisted this code
      });
      void this.catalogLoader.run();
    } catch {
      /* best-effort */
    }
  }

  /** Delete a custom factor; deselect it if it was open, then refresh the catalog. */
  public async removeFactor(id: string) {
    await deleteCustomFactor(id);
    if (this.selectedKey === id) {
      runInAction(() => {
        this.selectedKey = '';
        this.mode = 'preset';
        this.code = '';
        this.persistedCode = '';
        this.chatMessages = [];
        this.strategyKey = '';
        this.keyDraft = '';
        this.description = '';
        this.keyDraftEdited = false;
      });
      this.analysisLoader.reset();
    }
    await this.catalogLoader.run();
  }

  /** Run (or view, if cached) the analysis. For a custom factor, first COMMIT the code by id (which drops
   * stale cached reports + refreshes metadata) so the worker analyzes the current code; then run. A
   * cache hit returns instantly; otherwise a job streams progress. */
  public async runAnalysis(refresh = false) {
    if (this.mode === 'custom') {
      await this.ensureFactor(); // create if authoring a never-saved factor and running directly
      if (!this.selectedKey) {
        return;
      }
      if (this.code !== this.persistedCode) {
        try {
          await updateFactor(this.selectedKey, { code: this.code });
          runInAction(() => (this.persistedCode = this.code));
          void this.runsLoader.run(); // reports were dropped server-side
          void refreshFactorMetadata(this.selectedKey, this.code).then(() =>
            this.refreshIdentity(),
          );
        } catch (e) {
          await this.analysisLoader.run(Promise.reject(e)).catch(() => {});
          return;
        }
      }
    }
    runInAction(() => {
      this.logs = [];
      this.jobRunning = true;
    });
    try {
      const res = await runFactorAnalysis(
        this.selectedKey,
        this.freq,
        this.start,
        this.end,
        this.neutral,
        refresh,
      );
      if ('report' in res) {
        await this.analysisLoader.run(Promise.resolve(res.report));
        void this.runsLoader.run();
        this.finishJob();
      } else {
        this.startPolling(res.jobId);
      }
    } catch (e) {
      await this.analysisLoader.run(Promise.reject(e)).catch(() => {});
      this.finishJob();
    }
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
        this.strategyKey = factor.strategyKey ?? '';
        this.description = factor.description ?? '';
        if (!this.keyDraftEdited) {
          this.keyDraft = factor.keyCandidate ?? factor.key ?? '';
        }
      });
      await this.catalogLoader.run();
    } catch {
      /* best-effort */
    }
  }

  /** Finalize the code-facing key once. The server appends a suffix when the requested key is taken. */
  public async finalizeKey() {
    const finalized = await this.keyLoader.run(this.keyDraft);
    runInAction(() => {
      this.strategyKey = finalized.strategyKey;
      this.keyDraft = finalized.key;
      this.keyDraftEdited = false;
    });
    await this.catalogLoader.run();
  }

  /** On URL-restore: re-attach to a still-running job, else show the cached report, else the run prompt. */
  private async restoreOrRun() {
    if (!this.selectedKey) {
      return;
    }
    try {
      const { jobId } = await findFactorRunningJob(
        this.selectedKey,
        this.freq,
        this.start,
        this.end,
        this.neutral,
      );
      if (jobId) {
        this.startPolling(jobId);
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      const report = await getFactorAnalysis(
        this.selectedKey,
        this.freq,
        this.start,
        this.end,
        this.neutral,
      );
      await this.analysisLoader.run(Promise.resolve(report));
    } catch {
      this.analysisLoader.reset();
    }
  }

  private startPolling(jobId: string) {
    this.jobId = jobId;
    this.since = 0;
    runInAction(() => (this.jobRunning = true));
    this.analysisPoller.start();
  }

  /** One poll tick — append new logs; on finish fetch the persisted report. Returns false to stop. */
  private async pollOnce(): Promise<false | void> {
    try {
      const job = await pollFactorJob(this.jobId!, this.since);
      if (job.logs.length) {
        runInAction(() => (this.logs = [...this.logs, ...job.logs]));
        this.since = job.nextSince;
      }
      if (job.status === 'done') {
        const report = await getFactorAnalysis(
          this.selectedKey,
          this.freq,
          this.start,
          this.end,
          this.neutral,
        );
        await this.analysisLoader.run(Promise.resolve(report));
        void this.runsLoader.run();
        this.finishJob();
        return false;
      }
      if (job.status === 'error' || job.status === 'stale') {
        const msg =
          job.status === 'stale'
            ? i18n.t('factor:analysisInterrupted')
            : job.error || i18n.t('factor:analysisFailed');
        await this.analysisLoader.run(Promise.reject(new Error(msg))).catch(() => {});
        this.finishJob();
        return false;
      }
    } catch {
      this.finishJob();
      return false;
    }
  }

  private finishJob() {
    runInAction(() => (this.jobRunning = false));
  }

  /** Jump to a cached run: set its params, then fetch (hits the cache → instant). */
  public async applyRun(run: FactorRun) {
    runInAction(() => {
      this.freq = run.freq;
      this.neutral = run.neutral ?? 'none';
      this.start = run.start;
      this.end = run.end;
    });
    await this.analysisLoader.run();
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
