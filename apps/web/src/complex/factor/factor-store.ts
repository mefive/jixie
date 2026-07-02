import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type { FactorMeta, FactorReport, FactorRun, FactorFreq } from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import {
  getFactorCatalog,
  getFactorRuns,
  getFactorAnalysis,
  runFactorAnalysis,
  pollFactorJob,
} from '@src/api/client';

// Initial state from the URL (?factor=&freq=&start=&end=) — makes a report refresh-safe + shareable.
type FactorSetupParams = { factor?: string; freq?: FactorFreq; start?: string; end?: string };

const DEFAULT_START = '20150101';
const DEFAULT_END = '20261231';
const POLL_INTERVAL_MS = 800;

// localStorage: the analysis + jobId of a run in flight. Survives a refresh so we re-attach to its
// streaming logs (via the in-memory server job) instead of orphaning it / recomputing.
const FACTOR_JOB_KEY = 'jx:factor:job';
type JobPointer = { analysisId?: string; jobId?: string };
function readCurrentJob(): JobPointer {
  try {
    return JSON.parse(localStorage.getItem(FACTOR_JOB_KEY) || '{}');
  } catch {
    return {};
  }
}
function writeCurrentJob(pointer: JobPointer | null) {
  if (pointer?.jobId) localStorage.setItem(FACTOR_JOB_KEY, JSON.stringify(pointer));
  else localStorage.removeItem(FACTOR_JOB_KEY);
}

/**
 * 因子研究 store. Left: the factor catalog. Right: for the selected factor, an analysis over the current
 * (freq, start, end) params. Analysis is expensive (price factors ~100s), so it never auto-runs on
 * param edits — the user clicks 运行; if that 4-tuple is already cached, the button reads 查看 (instant).
 * Selecting a factor auto-loads its most-recent cached run (if any) so a re-visit shows instantly.
 */
export class FactorStore extends BaseStore<FactorSetupParams> {
  public catalogLoader = new LoaderModel<FactorMeta[]>();
  public analysisLoader = new LoaderModel<FactorReport>();
  public runsLoader = new LoaderModel<FactorRun[]>();
  public analysisPoller = new PollingModel(); // drives the job poll loop (like the lab's backtest)

  public selectedKey = '';
  public freq: FactorFreq = 'month';
  public start = DEFAULT_START;
  public end = DEFAULT_END;
  public logs: string[] = []; // streamed progress of the current run (job)
  public jobRunning = false; // a streamed analysis is in flight (submit → poll → done)
  private jobId: string | null = null; // current job's id (poll cursor lives in `since`)
  private since = 0;

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      selectedKey: observable.ref,
      freq: observable.ref,
      start: observable.ref,
      end: observable.ref,
      logs: observable.ref,
      jobRunning: observable.ref,
      selected: computed,
      report: computed,
      isCached: computed,
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

    // Restore from the URL: preselect the factor, then re-attach to a running job (if the page was
    // refreshed mid-analysis) or load/run the window (refresh-safe / shareable link).
    if (params.factor) {
      runInAction(() => {
        this.selectedKey = params.factor!;
        this.freq = params.freq ?? 'month';
        this.start = params.start ?? DEFAULT_START;
        this.end = params.end ?? DEFAULT_END;
      });
      void this.runsLoader.run();
      void this.restoreOrRun();
    }
  }

  private get analysisId(): string {
    return `${this.selectedKey}|${this.freq}|${this.start}|${this.end}`;
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

  public setFreq(v: FactorFreq) {
    runInAction(() => (this.freq = v));
  }
  public setStart(v: string) {
    runInAction(() => (this.start = v));
  }
  public setEnd(v: string) {
    runInAction(() => (this.end = v));
  }

  /** Pick a factor: load its cached runs, and auto-show the most recent one (cache hit → instant). */
  public async selectFactor(key: string) {
    this.analysisPoller.stop(); // drop any in-flight job for the previous factor
    runInAction(() => {
      this.selectedKey = key;
      this.jobRunning = false;
      this.logs = [];
    });
    const runs = await this.runsLoader.run();
    if (runs.length) {
      await this.applyRun(runs[0]); // most recent (runs come back computedAt desc)
    } else {
      this.analysisLoader.reset(); // fresh factor — wait for an explicit 运行
    }
  }

  /** Run (or view, if cached) the analysis. A cache hit returns instantly; otherwise a job starts and
   * its progress logs stream via the poller. The jobId is persisted so a refresh re-attaches. */
  public async runAnalysis(refresh = false) {
    runInAction(() => {
      this.logs = [];
      this.jobRunning = true;
    });
    try {
      const res = await runFactorAnalysis(this.selectedKey, this.freq, this.start, this.end, refresh);
      if ('report' in res) {
        await this.analysisLoader.run(Promise.resolve(res.report)); // cache hit — instant, no job
        void this.runsLoader.run();
        this.finishJob();
      } else {
        writeCurrentJob({ analysisId: this.analysisId, jobId: res.jobId });
        this.startPolling(res.jobId);
      }
    } catch (e) {
      await this.analysisLoader.run(Promise.reject(e)).catch(() => {});
      this.finishJob();
    }
  }

  /** Re-attach to a still-running job for the current analysis (page refreshed mid-run) — else run. */
  private async restoreOrRun() {
    const cur = readCurrentJob();
    if (cur.analysisId === this.analysisId && cur.jobId) {
      try {
        const job = await pollFactorJob(cur.jobId, 0);
        if (job.status === 'running') {
          runInAction(() => {
            this.logs = job.logs;
            this.jobRunning = true;
          });
          this.jobId = cur.jobId;
          this.since = job.logs.length;
          this.analysisPoller.start();
          return;
        }
      } catch {
        /* job expired / server restarted — fall through to a normal run (cache hit or recompute) */
      }
    }
    await this.runAnalysis();
  }

  private startPolling(jobId: string) {
    this.jobId = jobId;
    this.since = 0;
    this.analysisPoller.start();
  }

  /** One poll tick — append new logs; return false to stop the poller (done / error / expired). */
  private async pollOnce(): Promise<false | void> {
    try {
      const job = await pollFactorJob(this.jobId!, this.since);
      if (job.logs.length) {
        runInAction(() => (this.logs = [...this.logs, ...job.logs]));
        this.since += job.logs.length;
      }
      if (job.status === 'done') {
        await this.analysisLoader.run(Promise.resolve(job.report!));
        void this.runsLoader.run();
        this.finishJob();
        return false;
      }
      if (job.status === 'error') {
        await this.analysisLoader.run(Promise.reject(new Error(job.error))).catch(() => {});
        this.finishJob();
        return false;
      }
    } catch {
      this.finishJob(); // job expired (server restart / TTL) — stop polling
      return false;
    }
  }

  private finishJob() {
    writeCurrentJob(null);
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
