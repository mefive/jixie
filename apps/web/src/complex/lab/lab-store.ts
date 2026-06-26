import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type {
  BacktestConfig,
  BacktestSummary,
  Condition,
  Expr,
  PipelineIR,
  SavedMeta,
  Schedule,
  SizingMethod,
  Stage,
  StrategyIR,
  UniverseFilter,
} from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import {
  deleteStrategy,
  getStrategy,
  listStrategies,
  parseStrategy,
  pollBacktest,
  saveStrategy,
  submitBacktest,
} from '@src/api/client';
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

  // —— timing stage (optional): a per-instrument entry/exit overlay built from general conditions ——
  public timingOn = false;
  public entry: Condition = defaultEntry(); // when flat: buy if this holds (defaults to a breakout)
  public exit: Condition = defaultExit(); // when holding: sell if this holds (defaults to a breakdown)
  public membership: 'gate' | 'hard' = 'gate'; // held name that drops out of select: keep (gate) / sell (hard)

  // —— sizing stage ——
  public sizingMethod: SizingMethod = { kind: 'equal' };

  // —— NL→IR ——
  public nlText = '';

  // —— live backtest progress logs (streamed from the worker via polling) ——
  public logLines: string[] = [];

  public backtestLoader = new LoaderModel<BacktestSummary>();
  public parseLoader = new LoaderModel<{ ir: StrategyIR; attempts: number }>();
  public savedLoader = new LoaderModel<SavedMeta[]>(); // 我的策略 list (auto-saved on run)

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
      timingOn: observable.ref,
      entry: observable.ref,
      exit: observable.ref,
      membership: observable.ref,
      sizingMethod: observable.ref,
      nlText: observable.ref,
      logLines: observable.ref,
      selectedPresetKey: computed,
      irPreview: computed,
      setField: action,
      setPreset: action,
      loadStrategy: action,
      applyConfig: action,
      appendLogs: action,
    });
  }

  public setup(params: LabSetupParams) {
    super.setup(params);
    this.backtestLoader.setup({
      request: (_d, signal) =>
        runAndPoll(this.buildConfig(), signal, (lines) => this.appendLogs(lines)),
    });
    this.parseLoader.setup({ request: () => parseStrategy(this.nlText.trim()) });
    this.savedLoader.setup({ request: () => listStrategies() });
    this.registCleaner(() => this.backtestLoader.cleanup());
    this.registCleaner(() => this.parseLoader.cleanup());
    this.registCleaner(() => this.savedLoader.cleanup());
    void this.savedLoader.run(); // prime the 我的策略 dropdown
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

  /** Assemble the form state into the stage pipeline (universe → filter? → select → timing? → sizing). */
  public buildStages(): Stage[] {
    const stages: Stage[] = [{ kind: 'universe', source: { type: 'all' } }];

    const filters: UniverseFilter[] = [];
    if (this.minListDays > 0) filters.push({ kind: 'minListDays', days: this.minListDays });
    if (this.dropIlliquidPct > 0) filters.push({ kind: 'dropIlliquidPct', pct: this.dropIlliquidPct });
    filters.push(...this.extraFilters);
    if (filters.length) stages.push({ kind: 'filter', filters });

    stages.push({
      kind: 'select',
      score: this.score,
      factors: this.factors,
      side: this.side,
      pick: { by: 'quantile', value: this.quantile },
    });

    if (this.timingOn) {
      stages.push({ kind: 'timing', entry: this.entry, exit: this.exit, membership: this.membership });
    }

    stages.push({ kind: 'sizing', method: this.sizingMethod });
    return stages;
  }

  /** Assemble the form state into a runnable BacktestConfig (pipeline IR). */
  public buildConfig(): BacktestConfig {
    return {
      name: this.name.trim() || '未命名策略',
      start: this.start,
      end: this.end,
      initialCash: this.initialCash,
      strategy: { schedule: this.schedule, stages: this.buildStages() },
    };
  }

  /** Load a strategy IR (a stage pipeline) into the form fields. */
  public loadStrategy(ir: StrategyIR) {
    this.loadPipeline(ir);
  }

  /** Reflect a pipeline IR's stages back into the form fields. */
  private loadPipeline(ir: PipelineIR) {
    const stageOf = <K extends Stage['kind']>(k: K): Extract<Stage, { kind: K }> | undefined =>
      ir.stages.find((s): s is Extract<Stage, { kind: K }> => s.kind === k);
    runInAction(() => {
      this.schedule = ir.schedule;

      const filters = stageOf('filter')?.filters ?? [];
      const min = filters.find((f) => f.kind === 'minListDays');
      const drop = filters.find((f) => f.kind === 'dropIlliquidPct');
      this.minListDays = min?.kind === 'minListDays' ? min.days : 0;
      this.dropIlliquidPct = drop?.kind === 'dropIlliquidPct' ? drop.pct : 0;
      this.extraFilters = filters.filter(
        (f) => f.kind !== 'minListDays' && f.kind !== 'dropIlliquidPct',
      );

      const select = stageOf('select');
      if (select) {
        this.score = select.score;
        this.factors = select.factors;
        this.side = select.side;
        if (select.pick.by === 'quantile') this.quantile = select.pick.value;
      }

      const timing = stageOf('timing');
      this.timingOn = !!timing;
      if (timing) {
        this.entry = timing.entry;
        this.exit = timing.exit;
        this.membership = timing.membership;
      }

      const sizing = stageOf('sizing');
      if (sizing) this.sizingMethod = sizing.method;
    });
  }

  public get irPreview(): string {
    return JSON.stringify(this.buildConfig().strategy, null, 2);
  }

  public run() {
    runInAction(() => {
      this.logLines = []; // fresh progress log per run
    });
    // Auto-save the strategy on every run (upsert by name) — best-effort, never blocks the backtest.
    void saveStrategy(this.buildConfig())
      .then(() => this.savedLoader.run())
      .catch(() => {});
    void this.backtestLoader.run();
  }

  /** Append log lines streamed from the backtest worker (called by the polling loop). */
  public appendLogs(lines: string[]) {
    runInAction(() => {
      this.logLines = [...this.logLines, ...lines];
    });
  }

  /** Reflect a full saved BacktestConfig back into the form (range/capital + the strategy IR). */
  public applyConfig(config: BacktestConfig) {
    runInAction(() => {
      this.name = config.name;
      this.start = config.start;
      this.end = config.end;
      this.initialCash = config.initialCash;
    });
    this.loadStrategy(config.strategy);
  }

  /** Reopen a saved strategy: fetch its full config, then load it into the form. */
  public async openSaved(id: string) {
    const s = await getStrategy(id);
    this.applyConfig(s.config);
  }

  /** Delete a saved strategy, then refresh the list. */
  public removeSaved(id: string) {
    void deleteStrategy(id).then(() => this.savedLoader.run());
  }

  public loadSavedList() {
    void this.savedLoader.run();
  }

  /** NL→IR: parse the prompt, then reflect the returned IR into the form. */
  public async parse() {
    if (!this.nlText.trim()) return;
    const res = await this.parseLoader.run();
    this.loadStrategy(res.ir);
  }
}

/** Default entry/exit when timing is first enabled — a Donchian breakout/breakdown, but every operand
 * is fully editable in the condition editor (not a locked preset). */
function defaultEntry(): Condition {
  return {
    kind: 'compare',
    op: '>',
    left: { kind: 'price' },
    right: { kind: 'indicator', name: 'highest', field: 'high', window: 20 },
  };
}
function defaultExit(): Condition {
  return {
    kind: 'compare',
    op: '<',
    left: { kind: 'price' },
    right: { kind: 'indicator', name: 'lowest', field: 'low', window: 10 },
  };
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
