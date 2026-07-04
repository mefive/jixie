import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type {
  ChatMessage,
  FactorMeta,
  FactorReport,
  FactorRun,
  FactorFreq,
  LogLine,
} from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
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
  sendFactorAgent,
  generateFactorName,
} from '@src/api/client';

// Initial state from the URL (?factor=&freq=&start=&end=) — makes a report refresh-safe + shareable.
type FactorSetupParams = { factor?: string; freq?: FactorFreq; start?: string; end?: string };

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
 * 因子研究 store — Agent-authored, IDE-style (mirrors the strategy workbench). Two kinds of factor:
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
  public analysisPoller = new PollingModel();

  public selectedKey = ''; // preset key OR custom factor id — the analysis target
  public mode: 'preset' | 'custom' = 'preset';
  public code = ''; // the custom factor's defineFactor source (empty for presets)
  public persistedCode = ''; // code as persisted in the DB — baseline for `edited`
  public chatMessages: ChatMessage[] = []; // the Agent conversation for the current custom factor
  public sending = false; // an Agent turn is in flight
  public nlText = ''; // the Agent chat draft

  public freq: FactorFreq = 'month';
  public start = DEFAULT_START;
  public end = DEFAULT_END;
  public logs: LogLine[] = []; // streamed progress of the current run (job), tagged system/user
  public jobRunning = false; // a streamed analysis is in flight

  private jobId: string | null = null;
  private since = 0;

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
      freq: observable.ref,
      start: observable.ref,
      end: observable.ref,
      logs: observable.ref,
      jobRunning: observable.ref,
      selected: computed,
      report: computed,
      isCached: computed,
      edited: computed,
      setFreq: action,
      setStart: action,
      setEnd: action,
    });
  }

  public setup(params: FactorSetupParams) {
    super.setup(params);
    this.catalogLoader.setup({ request: () => getFactorCatalog() });
    this.runsLoader.setup({ request: () => getFactorRuns(this.selectedKey) });
    this.analysisLoader.setup({
      request: (refresh = false) =>
        getFactorAnalysis(this.selectedKey, this.freq, this.start, this.end, refresh),
    });
    this.analysisPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollOnce() });
    this.registCleaner(() => this.catalogLoader.cleanup());
    this.registCleaner(() => this.runsLoader.cleanup());
    this.registCleaner(() => this.analysisLoader.cleanup());
    this.registCleaner(() => this.analysisPoller.cleanup());
    void this.catalogLoader.run();

    // Restore from the URL: preselect the factor, then re-attach to a running job (refreshed mid-run)
    // or load/run the window (refresh-safe / shareable link).
    if (params.factor) {
      runInAction(() => {
        this.freq = params.freq ?? 'month';
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

  /** Whether the current (factor, freq, start, end) is already computed — drives the 运行/查看 label. */
  public get isCached(): boolean {
    return (this.runsLoader.result ?? []).some(
      (r) => r.freq === this.freq && r.start === this.start && r.end === this.end,
    );
  }

  /** A custom factor has unsaved code edits vs. the persisted DB copy → gates the leave guard. */
  public get edited(): boolean {
    return this.mode === 'custom' && this.code !== this.persistedCode;
  }

  public setFreq(v: FactorFreq) {
    runInAction(() => (this.freq = v));
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

  /** Pick a factor from the 因子库. A preset → analysis-only (no editor/chat). A custom factor → load its
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
      if (!isCustom) {
        this.code = '';
        this.persistedCode = '';
        this.chatMessages = [];
      }
    });
    if (isCustom) {
      try {
        const factor = await getCustomFactor(key);
        runInAction(() => {
          this.code = factor.code;
          this.persistedCode = factor.code;
          this.chatMessages = factor.messages ?? [];
        });
      } catch {
        /* factor gone (deleted elsewhere) — leave blank */
      }
    }
    const runs = await this.runsLoader.run();
    if (runs.length) {
      await this.applyRun(runs[0]); // most recent (computedAt desc)
    } else {
      this.analysisLoader.reset(); // fresh factor — wait for an explicit 运行
    }
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
    // Continue editing only when the current selection is a SAVED custom factor; otherwise (a preset is
    // selected, or nothing) a chat starts a fresh custom factor — clear the selection so ensureFactor
    // creates a new row instead of attaching to the preset.
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
      this.chatMessages = [...this.chatMessages, { role: 'user', content: text }];
      this.sending = true;
      this.nlText = '';
    });
    await this.ensureFactor(text);
    try {
      const history = this.chatMessages.slice(0, -1);
      const res = await sendFactorAgent(history, text, this.code);
      runInAction(() => {
        this.chatMessages = [...this.chatMessages, { role: 'assistant', content: res.reply }];
        if (res.changed) {
          this.code = res.code; // editor updates; analysis result stays until the next run
        }
      });
      void this.persistMessages();
    } catch (e) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          { role: 'assistant', content: `出错了:${e instanceof Error ? e.message : '请求失败'}` },
        ];
      });
    } finally {
      runInAction(() => (this.sending = false));
    }
  }

  /** Create the factor row if it doesn't exist yet (first Agent prompt). Names it via the LLM from the
   * prompt. Best-effort; a later run retries. */
  private async ensureFactor(namePrompt?: string) {
    if (this.selectedKey) {
      return;
    }
    let name = '未命名因子';
    try {
      const suggested = await generateFactorName(
        namePrompt ? { prompt: namePrompt } : { code: this.code },
      );
      name = suggested.name;
    } catch {
      /* naming is best-effort */
    }
    try {
      const meta = await createFactor(name, this.code, this.chatMessages);
      runInAction(() => {
        this.selectedKey = meta.id;
        this.persistedCode = this.code; // just persisted this code
      });
      void this.catalogLoader.run();
    } catch {
      /* best-effort */
    }
  }

  /** Save the conversation onto the factor in real time (by id). No-op until the factor exists. */
  private async persistMessages() {
    if (!this.selectedKey || this.mode !== 'custom') {
      return;
    }
    try {
      await updateFactor(this.selectedKey, { messages: this.chatMessages });
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
      });
      this.analysisLoader.reset();
    }
    await this.catalogLoader.run();
  }

  /** Run (or view, if cached) the analysis. For a custom factor, first COMMIT the code by id (which drops
   * stale cached reports + re-derives the name) so the worker analyzes the current code; then run. A
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
          void this.refreshName();
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

  /** Re-derive the custom factor's name from its code (keeps the current name when it still fits), then
   * persist just the name by id. Background — doesn't block analysis. */
  private async refreshName() {
    if (!this.selectedKey || this.mode !== 'custom') {
      return;
    }
    try {
      const meta = this.selected;
      const { name } = await generateFactorName({ code: this.code, currentName: meta?.label });
      if (name && name !== meta?.label) {
        await updateFactor(this.selectedKey, { name });
        void this.catalogLoader.run();
      }
    } catch {
      /* best-effort */
    }
  }

  /** On URL-restore: re-attach to a still-running job, else show the cached report, else the 运行 prompt. */
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
      );
      if (jobId) {
        this.startPolling(jobId);
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      const report = await getFactorAnalysis(this.selectedKey, this.freq, this.start, this.end);
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
        const report = await getFactorAnalysis(this.selectedKey, this.freq, this.start, this.end);
        await this.analysisLoader.run(Promise.resolve(report));
        void this.runsLoader.run();
        this.finishJob();
        return false;
      }
      if (job.status === 'error' || job.status === 'stale') {
        const msg = job.status === 'stale' ? '分析中断(服务重启),请重试' : job.error || '分析失败';
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
      this.start = run.start;
      this.end = run.end;
    });
    await this.analysisLoader.run();
  }
}
