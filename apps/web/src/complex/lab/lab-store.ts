import { computed, makeObservable, observable, runInAction } from 'mobx';
import type { BacktestConfig, BacktestSummary, StrategyCard } from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import {
  deleteStrategy,
  generateCode,
  generateName,
  getStrategy,
  listStrategies,
  pollBacktest,
  saveBacktestResult,
  saveStrategy,
  submitBacktest,
} from '@src/api/client';
import { DEFAULT_CODE } from './default-strategy';

type LabSetupParams = { id?: string };

/**
 * Backtest workbench store — code-first. The strategy is a single TS source string (`code`); the server
 * compiles and runs it. `/lab/:id` loads a saved strategy + its last result on mount (refresh-safe), and
 * re-attaches to a running backtest via the localStorage job pointer + PollingModel.
 */
export class LabStore extends BaseStore<LabSetupParams> {
  public name = 'MA20 突破 · 贵州茅台';
  public start = '20200101';
  public end = '20241231';
  public initialCash = 1_000_000;
  public code = DEFAULT_CODE;

  public nlText = ''; // NL→code

  public logLines: string[] = []; // live backtest progress (streamed via polling)
  public result: BacktestSummary | null = null; // a finished run OR the saved last-result on reopen
  public error: string | null = null; // backtest failure message
  public savedId: string | null = null; // this strategy's DB id (for the URL)

  private jobId: string | null = null; // polling cursor for the current backtest
  private since = 0;

  public backtestPoller = new PollingModel();
  public codegenLoader = new LoaderModel<{ code: string; attempts: number }>(); // NL→code
  public savedLoader = new LoaderModel<StrategyCard[]>(); // 我的策略 cards

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      name: observable.ref,
      start: observable.ref,
      end: observable.ref,
      initialCash: observable.ref,
      code: observable.ref,
      nlText: observable.ref,
      logLines: observable.ref,
      result: observable.ref,
      error: observable.ref,
      savedId: observable.ref,
      config: computed,
    });
  }

  public setup(params: LabSetupParams) {
    super.setup(params);
    this.backtestPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollOnce() });
    this.codegenLoader.setup({ request: () => generateCode(this.nlText.trim()) });
    this.savedLoader.setup({ request: () => listStrategies() });
    this.registCleaner(() => this.backtestPoller.cleanup());
    this.registCleaner(() => this.codegenLoader.cleanup());
    this.registCleaner(() => this.savedLoader.cleanup());
    void this.savedLoader.run(); // prime 我的策略
    if (params.id) void this.openSaved(params.id);
  }

  /** True while a backtest is running (drives the loading state + progress log). */
  public get running(): boolean {
    return this.backtestPoller.running;
  }

  /** Range/capital + the strategy code → a runnable BacktestConfig. */
  public get config(): BacktestConfig {
    return {
      name: this.name.trim() || '未命名策略',
      start: this.start,
      end: this.end,
      initialCash: this.initialCash,
      code: this.code,
    };
  }

  public setField<K extends keyof LabStore>(key: K, value: LabStore[K]) {
    runInAction(() => {
      (this as LabStore)[key] = value;
    });
  }

  /** NL→code: generate a strategy from the prompt (server compiles it) → drop it into the editor. */
  public async generate() {
    if (!this.nlText.trim()) return;
    const r = await this.codegenLoader.run();
    runInAction(() => {
      this.code = r.code;
    });
  }

  /** Start fresh: a blank-named strategy on the default template (blank name → auto-named on first run). */
  public newStrategy() {
    runInAction(() => {
      this.name = '';
      this.code = DEFAULT_CODE;
      this.nlText = '';
      this.result = null;
      this.error = null;
      this.logLines = [];
      this.savedId = null;
    });
    writeCurrent({});
  }

  public async run() {
    // Auto-name from the code when 策略名称 is blank (the user can edit it after).
    if (!this.name.trim()) {
      try {
        const { name } = await generateName(this.code);
        runInAction(() => {
          this.name = name;
        });
      } catch {
        runInAction(() => {
          this.name = '未命名策略';
        });
      }
    }
    runInAction(() => {
      this.logLines = [];
      this.result = null;
      this.error = null;
    });
    // Save first so the strategy has an id (for the URL + the running-job pointer).
    try {
      const meta = await saveStrategy(this.config);
      runInAction(() => {
        this.savedId = meta.id;
      });
      writeCurrent({ strategyId: meta.id });
      void this.savedLoader.run();
    } catch {
      /* best-effort */
    }
    let jobId: string;
    try {
      ({ jobId } = await submitBacktest(this.config));
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : '回测提交失败';
      });
      return;
    }
    writeCurrent({ strategyId: this.savedId ?? undefined, jobId });
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
  public appendLogs(lines: string[]) {
    runInAction(() => {
      this.logLines = [...this.logLines, ...lines];
    });
  }

  /** Reflect a full saved BacktestConfig back into the editor (range/capital + code). */
  public applyConfig(config: BacktestConfig) {
    runInAction(() => {
      this.name = config.name;
      this.start = config.start;
      this.end = config.end;
      this.initialCash = config.initialCash;
      this.code = config.code;
    });
  }

  /** Reopen a saved strategy: load its config + last result, and re-attach to a running backtest if one
   * is still in flight for it (so a refresh continues streaming logs instead of losing the run). */
  public async openSaved(id: string) {
    let s;
    try {
      s = await getStrategy(id);
    } catch {
      writeCurrent({}); // strategy gone (deleted) — don't loop redirecting to it
      return;
    }
    this.applyConfig(s.config);
    runInAction(() => {
      this.result = s.lastResult ?? null;
      this.error = null;
      this.savedId = id;
    });
    const cur = readCurrent();
    if (cur.strategyId === id && cur.jobId) {
      try {
        const job = await pollBacktest(cur.jobId, 0);
        if (job.status === 'running') {
          this.resume(cur.jobId); // re-attach to live logs
          return;
        }
        if (job.status === 'done') runInAction(() => (this.result = job.result));
      } catch {
        /* job expired / server restarted — fall back to the saved last result */
      }
    }
    writeCurrent({ strategyId: id });
  }

  /** Delete a saved strategy, then refresh the list. */
  public removeSaved(id: string) {
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

  /** One poll tick — append new logs; return false to stop the poller (done / error / expired). */
  private async pollOnce(): Promise<false | void> {
    try {
      const job = await pollBacktest(this.jobId!, this.since);
      if (job.logs.length) {
        this.appendLogs(job.logs);
        this.since = job.nextSince;
      }
      if (job.status === 'done') {
        runInAction(() => {
          this.result = job.result;
        });
        void saveBacktestResult(this.config.name, job.result).catch(() => {});
        writeCurrent({ strategyId: this.savedId ?? undefined }); // run finished → drop the job pointer
        return false;
      }
      if (job.status === 'error') {
        runInAction(() => {
          this.error = job.message ?? '回测失败';
        });
        writeCurrent({ strategyId: this.savedId ?? undefined });
        return false;
      }
    } catch {
      // job expired (server restart) / network — stop; the saved last result (if any) stays shown.
      writeCurrent({ strategyId: this.savedId ?? undefined });
      return false;
    }
  }
}

// —— helpers ——

const POLL_INTERVAL_MS = 1500;
// localStorage: which strategy is open + (if running) its backtest jobId. Survives a refresh so we can
// reopen the strategy and re-attach to a still-running backtest's logs (same server process).
const CURRENT_KEY = 'jx:lab:current';

type Current = { strategyId?: string; jobId?: string };

function readCurrent(): Current {
  try {
    return JSON.parse(localStorage.getItem(CURRENT_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCurrent(c: Current) {
  localStorage.setItem(CURRENT_KEY, JSON.stringify(c));
}
