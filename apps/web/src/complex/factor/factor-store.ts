import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type { FactorMeta, FactorReport, FactorRun, FactorFreq } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import { getFactorCatalog, getFactorRuns, getFactorAnalysis } from '@src/api/client';

type FactorSetupParams = {};

const DEFAULT_START = '20150101';
const DEFAULT_END = '20261231';

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

  public selectedKey = '';
  public freq: FactorFreq = 'month';
  public start = DEFAULT_START;
  public end = DEFAULT_END;

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      selectedKey: observable.ref,
      freq: observable.ref,
      start: observable.ref,
      end: observable.ref,
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
    this.registCleaner(() => this.catalogLoader.cleanup());
    this.registCleaner(() => this.runsLoader.cleanup());
    this.registCleaner(() => this.analysisLoader.cleanup());
    void this.catalogLoader.run();
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
    runInAction(() => {
      this.selectedKey = key;
    });
    const runs = await this.runsLoader.run();
    if (runs.length) {
      await this.applyRun(runs[0]); // most recent (runs come back computedAt desc)
    } else {
      this.analysisLoader.reset(); // fresh factor — wait for an explicit 运行
    }
  }

  /** Run (or view, if cached) the analysis for the current params, then refresh the run chips. */
  public async runAnalysis(refresh = false) {
    await this.analysisLoader.run(refresh);
    await this.runsLoader.run();
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
