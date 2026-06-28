import { computed, makeObservable, observable, runInAction } from 'mobx';
import type { BacktestConfig, BacktestSummary, StrategyCard } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
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

type LabSetupParams = {};

const POLL_INTERVAL_MS = 1500;

/**
 * Backtest workbench store — code-first. The strategy is a single TS source string (`code`); the server
 * compiles and runs it. No IR, no form-to-IR assembly: range/capital + the code IS the config.
 */
export class LabStore extends BaseStore<LabSetupParams> {
  public name = 'MA20 突破 · 贵州茅台';
  public start = '20200101';
  public end = '20241231';
  public initialCash = 1_000_000;
  public code = DEFAULT_CODE;

  // NL→code
  public nlText = '';

  // live backtest progress logs (streamed from the worker via polling)
  public logLines: string[] = [];
  // the displayed result: a finished run OR the saved last-result loaded on reopen
  public result: BacktestSummary | null = null;

  public backtestLoader = new LoaderModel<BacktestSummary>();
  public codegenLoader = new LoaderModel<{ code: string; attempts: number }>(); // NL→code
  public savedLoader = new LoaderModel<StrategyCard[]>(); // 我的策略 cards (auto-saved on run)

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
      config: computed,
    });
  }

  public setup(params: LabSetupParams) {
    super.setup(params);
    this.backtestLoader.setup({
      request: (_d, signal) => runAndPoll(this.config, signal, (lines) => this.appendLogs(lines)),
    });
    this.codegenLoader.setup({ request: () => generateCode(this.nlText.trim()) });
    this.savedLoader.setup({ request: () => listStrategies() });
    this.registCleaner(() => this.backtestLoader.cleanup());
    this.registCleaner(() => this.codegenLoader.cleanup());
    this.registCleaner(() => this.savedLoader.cleanup());
    void this.savedLoader.run(); // prime the 我的策略 dropdown
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

  /** Start fresh: a blank-named strategy on the default template (blank name → auto-named on first run). */
  public newStrategy() {
    runInAction(() => {
      this.name = '';
      this.code = DEFAULT_CODE;
      this.nlText = '';
      this.result = null;
      this.logLines = [];
    });
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
      this.logLines = []; // fresh progress log per run
      this.result = null; // drop the previous/loaded result while the new run computes
    });
    // Auto-save the strategy on every run (upsert by name) — best-effort, never blocks the backtest.
    void saveStrategy(this.config)
      .then(() => this.savedLoader.run())
      .catch(() => {});
    void this.backtestLoader
      .run()
      .then((r) => {
        runInAction(() => {
          this.result = r;
        });
        void saveBacktestResult(this.config.name, r).catch(() => {}); // persist last result (one JSON)
      })
      .catch(() => {}); // error surfaces via backtestLoader.error
  }

  /** Append log lines streamed from the backtest worker (called by the polling loop). */
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

  /** Reopen a saved strategy: fetch its full config + last result, load both. */
  public async openSaved(id: string) {
    const s = await getStrategy(id);
    this.applyConfig(s.config);
    runInAction(() => {
      this.result = s.lastResult ?? null; // show the last run's metrics/chart/trades without re-running
    });
  }

  /** Delete a saved strategy, then refresh the list. */
  public removeSaved(id: string) {
    void deleteStrategy(id).then(() => this.savedLoader.run());
  }

  public loadSavedList() {
    void this.savedLoader.run();
  }
}

// —— helpers ——

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

/** Submit the backtest, then poll until done — the unit of work behind the LoaderModel. Each poll
 * carries the new log lines since `since`; `onLog` forwards them to the store for live display. */
async function runAndPoll(
  config: BacktestConfig,
  signal: AbortSignal,
  onLog: (lines: string[]) => void,
): Promise<BacktestSummary> {
  const { jobId } = await submitBacktest(config);
  let since = 0;
  for (;;) {
    await delay(POLL_INTERVAL_MS, signal);
    const job = await pollBacktest(jobId, since);
    if (job.logs.length) {
      onLog(job.logs);
      since = job.nextSince;
    }
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error(job.message);
  }
}
