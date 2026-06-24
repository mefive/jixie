import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type { BacktestConfig, BacktestSummary } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import { pollBacktest, submitBacktest } from '@src/api/client';
import { PRESET_BY_KEY } from './presets';

type LabSetupParams = {};

const POLL_INTERVAL_MS = 1500;

/**
 * Backtest workbench store. Holds the strategy-config form state, builds it into a BacktestConfig IR,
 * and runs the backtest through a LoaderModel whose request submits the job then polls until it's
 * done (a backtest takes tens of seconds to minutes, so the API is submit + poll, not synchronous).
 */
export class LabStore extends BaseStore<LabSetupParams> {
  // —— form state ——
  public name = '我的策略';
  public start = '20150101';
  public end = '20241231';
  public initialCash = 1_000_000;
  public presetKey = 'ep';
  public side: 'high' | 'low' = 'high';
  public quantile = 0.1;
  public minListDays = 365;
  public dropIlliquidPct = 25;

  public backtestLoader = new LoaderModel<BacktestSummary>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      name: observable.ref,
      start: observable.ref,
      end: observable.ref,
      initialCash: observable.ref,
      presetKey: observable.ref,
      side: observable.ref,
      quantile: observable.ref,
      minListDays: observable.ref,
      dropIlliquidPct: observable.ref,
      irPreview: computed,
      setField: action,
      setPreset: action,
    });
  }

  public setup(params: LabSetupParams) {
    super.setup(params);
    // The request closure reads buildConfig() at call time, so it always submits the current form.
    this.backtestLoader.setup({
      request: (_data, signal) => runAndPoll(this.buildConfig(), signal),
    });
    this.registCleaner(() => this.backtestLoader.cleanup());
  }

  /** Update a single primitive form field. */
  public setField<K extends keyof LabStore>(key: K, value: LabStore[K]) {
    runInAction(() => {
      (this as LabStore)[key] = value;
    });
  }

  /** Pick a scoring preset; preselect its natural side. */
  public setPreset(key: string) {
    runInAction(() => {
      this.presetKey = key;
      this.side = PRESET_BY_KEY[key]?.defaultSide ?? 'high';
    });
  }

  /** Assemble the form state into a BacktestConfig IR (the single source of truth). */
  public buildConfig(): BacktestConfig {
    const preset = PRESET_BY_KEY[this.presetKey];
    return {
      name: this.name.trim() || '未命名策略',
      start: this.start,
      end: this.end,
      initialCash: this.initialCash,
      strategy: {
        type: 'cross_section',
        schedule: 'monthly',
        universe: {
          filters: [
            { kind: 'minListDays', days: this.minListDays },
            { kind: 'dropIlliquidPct', pct: this.dropIlliquidPct },
          ],
        },
        score: preset.score,
        factors: preset.factors,
        pick: { side: this.side, quantile: this.quantile },
        weight: 'equal',
      },
    };
  }

  public get irPreview(): string {
    return JSON.stringify(this.buildConfig().strategy, null, 2);
  }

  public run() {
    void this.backtestLoader.run();
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

/** Submit the backtest, then poll until it's done — the unit of work behind the LoaderModel. */
async function runAndPoll(config: BacktestConfig, signal: AbortSignal): Promise<BacktestSummary> {
  const { jobId } = await submitBacktest(config);
  for (;;) {
    await delay(POLL_INTERVAL_MS, signal);
    const job = await pollBacktest(jobId);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error(job.message);
  }
}
