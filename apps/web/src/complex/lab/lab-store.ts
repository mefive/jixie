import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type {
  BacktestConfig,
  BacktestSummary,
  Expr,
  Schedule,
  StrategyIR,
  UniverseFilter,
} from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import { parseStrategy, pollBacktest, submitBacktest } from '@src/api/client';
import { PRESET_BY_KEY, FACTOR_PRESETS } from './presets';

type LabSetupParams = {};

const POLL_INTERVAL_MS = 1500;

/**
 * Backtest workbench store. The strategy's `score`/`factors` are the source of truth (the IR), not a
 * preset key: the preset dropdown just sets them, and the NL→IR parser sets them too — so an
 * AI-authored strategy reflects honestly into the form (matched to a preset, or shown as 自定义).
 */
export class LabStore extends BaseStore<LabSetupParams> {
  // —— range / capital ——
  public name = '我的策略';
  public start = '20150101';
  public end = '20241231';
  public initialCash = 1_000_000;

  // —— strategy IR pieces (source of truth) ——
  public schedule: Schedule = 'monthly';
  public score: Expr = PRESET_BY_KEY.ep.score;
  public factors?: string[] = PRESET_BY_KEY.ep.factors;
  public side: 'high' | 'low' = 'high';
  public quantile = 0.1;
  public minListDays = 365;
  public dropIlliquidPct = 25;
  public extraFilters: UniverseFilter[] = []; // any non-(minListDays/dropIlliquidPct) filters from AI

  // —— NL→IR ——
  public nlText = '';

  public backtestLoader = new LoaderModel<BacktestSummary>();
  public parseLoader = new LoaderModel<{ ir: StrategyIR; attempts: number }>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      name: observable.ref,
      start: observable.ref,
      end: observable.ref,
      initialCash: observable.ref,
      schedule: observable.ref,
      score: observable.ref,
      factors: observable.ref,
      side: observable.ref,
      quantile: observable.ref,
      minListDays: observable.ref,
      dropIlliquidPct: observable.ref,
      extraFilters: observable.ref,
      nlText: observable.ref,
      selectedPresetKey: computed,
      irPreview: computed,
      setField: action,
      setPreset: action,
      applyIr: action,
    });
  }

  public setup(params: LabSetupParams) {
    super.setup(params);
    this.backtestLoader.setup({
      request: (_d, signal) => runAndPoll(this.buildConfig(), signal),
    });
    this.parseLoader.setup({ request: () => parseStrategy(this.nlText.trim()) });
    this.registCleaner(() => this.backtestLoader.cleanup());
    this.registCleaner(() => this.parseLoader.cleanup());
  }

  public setField<K extends keyof LabStore>(key: K, value: LabStore[K]) {
    runInAction(() => {
      (this as LabStore)[key] = value;
    });
  }

  /** Pick a scoring preset → set the score/factors/side it implies. */
  public setPreset(key: string) {
    const p = PRESET_BY_KEY[key];
    if (!p) return;
    runInAction(() => {
      this.score = p.score;
      this.factors = p.factors;
      this.side = p.defaultSide;
    });
  }

  /** Which preset the current score matches (for the dropdown), or 'custom' if none. */
  public get selectedPresetKey(): string {
    const hit = FACTOR_PRESETS.find((p) => exprEqual(p.score, this.score));
    return hit ? hit.key : 'custom';
  }

  /** Reflect a parsed/edited strategy IR into the form fields. */
  public applyIr(ir: StrategyIR) {
    runInAction(() => {
      this.schedule = ir.schedule;
      this.score = ir.score;
      this.factors = ir.factors;
      this.side = ir.pick.side;
      this.quantile = ir.pick.quantile;
      const min = ir.universe.filters.find((f) => f.kind === 'minListDays');
      const drop = ir.universe.filters.find((f) => f.kind === 'dropIlliquidPct');
      this.minListDays = min?.kind === 'minListDays' ? min.days : 0;
      this.dropIlliquidPct = drop?.kind === 'dropIlliquidPct' ? drop.pct : 0;
      this.extraFilters = ir.universe.filters.filter(
        (f) => f.kind !== 'minListDays' && f.kind !== 'dropIlliquidPct',
      );
    });
  }

  /** Assemble the form state into a BacktestConfig IR. */
  public buildConfig(): BacktestConfig {
    const filters: UniverseFilter[] = [];
    if (this.minListDays > 0) filters.push({ kind: 'minListDays', days: this.minListDays });
    if (this.dropIlliquidPct > 0) filters.push({ kind: 'dropIlliquidPct', pct: this.dropIlliquidPct });
    filters.push(...this.extraFilters);
    return {
      name: this.name.trim() || '未命名策略',
      start: this.start,
      end: this.end,
      initialCash: this.initialCash,
      strategy: {
        type: 'cross_section',
        schedule: this.schedule,
        universe: { filters },
        score: this.score,
        factors: this.factors,
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

  /** NL→IR: parse the prompt, then reflect the returned IR into the form. */
  public async parse() {
    if (!this.nlText.trim()) return;
    const res = await this.parseLoader.run();
    this.applyIr(res.ir);
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

/** Submit the backtest, then poll until done — the unit of work behind the LoaderModel. */
async function runAndPoll(config: BacktestConfig, signal: AbortSignal): Promise<BacktestSummary> {
  const { jobId } = await submitBacktest(config);
  for (;;) {
    await delay(POLL_INTERVAL_MS, signal);
    const job = await pollBacktest(jobId);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error(job.message);
  }
}

/** Structural equality for Expr ASTs (key-order-independent), used to match score → preset. */
function exprEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    exprEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
