import type {
  BarContext,
  BarRow,
  OhlcBar,
  ResamplePeriod,
  Strategy,
  StrategyAccounts,
} from '../../engine/types.js';
import { isoWeekKey } from '../../lib/date.js';

/**
 * The strategy SDK — what user code is written against. Full code-first: a strategy is just
 * `export default defineStrategy({ onBar(ctx) { … } })`, and the structured operations that used to be
 * IR stages (schedule / select / sizing) are now one-line *library* calls on `ctx`, not a parallel
 * representation. So the boilerplate stays gone, but there's a single source of truth — the code.
 *
 * `enrich` layers these helpers onto the engine's core BarContext, so the engine stays lean (raw market
 * primitives + order intents) and the sugar lives here. Authoring is import-free: `defineStrategy` and
 * the StrategyCtx type are injected ambients (a .d.ts gives Monaco the same surface).
 */

export type Schedule = 'daily' | 'weekly' | 'monthly';
export type StrategyParamValue = number | string;
export type StrategyParams = Record<string, StrategyParamValue>;
export type WidenStrategyParams<Params extends StrategyParams> = {
  [Key in keyof Params]: Params[Key] extends number ? number : string;
};

/** What user code sees each bar: the engine primitives (BarContext) + the SDK helpers below. */
export interface StrategyCtx<Params extends StrategyParams = StrategyParams> extends BarContext {
  /** Frozen run parameters. Parameter scans override declared defaults without rewriting source. */
  readonly params: Readonly<WidenStrategyParams<Params>>;
  /** Period key for today on a schedule — compare to your own `let last` to fire once per period:
   * `if (ctx.period('monthly') === last) return; last = ctx.period('monthly');` */
  period(schedule: Schedule): string;
  /** Today's tradable universe as a chainable selection (loads the cross-section; bar() valid after).
   * Pass an index code (e.g. '000300.SH' CSI 300) to restrict to its point-in-time constituents — the
   * restriction is pushed into the data load (only those rows are read), not filtered in memory after. */
  universe(indexCode?: string): Promise<Universe>;
  /** Equal-weight the given codes (a target-book rebalance at next open). */
  equalWeight(codes: string[]): void;
  /** ATR risk sizing in engine-adjusted shares: a one-ATR adverse move risks about value × riskPct.
   * The eventual buy fill is still rounded to real 100-share lots by the engine. */
  atrUnits(code: string, riskPct: number, atrPeriod?: number): number;
  /** Inverse-volatility weights over loaded daily closes; codes without enough valid history are
   * omitted and the remaining weights sum to 1. */
  volTargetWeights(codes: string[], lookback?: number): Map<string, number>;
  /** Completed ISO-week bars and indicators for a loaded instrument. The current partial week is
   * excluded; on its final market trading day it becomes visible after that day's close. */
  weekly(code: string): TimeframeSeries;
  /** Completed natural-month bars and indicators for a loaded instrument. The current partial month
   * is excluded; on its final market trading day it becomes visible after that day's close. */
  monthly(code: string): TimeframeSeries;

  // —— Built-in technical indicators (each requires the stock's K-line already loaded: watch preload or ensureBars; return null when data is insufficient) ——
  /** n-day simple moving average (SMA) = arithmetic mean of the last n closes. The basis of trend/MA strategies. */
  sma(code: string, n: number): number | null;
  /** n-day exponential moving average (EMA): also a moving average, but weights recent prices more, tracking price faster than SMA. */
  ema(code: string, n: number): number | null;
  /** n-day ATR (Average True Range): measures how much this stock has moved per day recently, often used to set stop distance / position size. Needs n+1 bars. */
  atr(code: string, n: number): number | null;
  /** Highest value of a field over the last n bars (Donchian upper channel) — a price breakout above it is often an entry signal. */
  highest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null;
  /** Lowest value of a field over the last n bars (Donchian lower channel) — a price breakdown below it is often an exit signal. */
  lowest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null;
  /** n-day average turnover (thousand yuan) — measures liquidity (whether you can get in and out), often used as a slippage/liquidity gate in stock selection. */
  avgAmount(code: string, n: number): number | null;
  /** n-day average volume (lots) — likewise measures activity / liquidity. */
  avgVol(code: string, n: number): number | null;
}

/** A completed higher-timeframe OHLC series. All windows are oldest → newest and require the
 * instrument's daily bars to be preloaded through watch or ensureBars(). */
export interface TimeframeSeries {
  bars(n: number): OhlcBar[];
  history(field: 'open' | 'high' | 'low' | 'close', n: number): number[];
  sma(n: number): number | null;
  ema(n: number): number | null;
  atr(n: number): number | null;
  highest(field: 'open' | 'high' | 'low' | 'close', n: number): number | null;
  lowest(field: 'open' | 'high' | 'low' | 'close', n: number): number | null;
  avgAmount(n: number): number | null;
  avgVol(n: number): number | null;
}

class ResampledSeries implements TimeframeSeries {
  constructor(
    private readonly ctx: BarContext,
    private readonly code: string,
    private readonly period: ResamplePeriod,
  ) {}

  bars(n: number): OhlcBar[] {
    return this.ctx.resampledBars(this.code, this.period, n);
  }

  history(field: 'open' | 'high' | 'low' | 'close', n: number): number[] {
    return this.bars(n).map((bar) => ohlcField(bar, field));
  }

  sma(n: number): number | null {
    return smaValues(this.history('close', n), n);
  }

  ema(n: number): number | null {
    return emaValues(this.history('close', n * 4), n);
  }

  atr(n: number): number | null {
    return atrBars(this.bars(n + 1), n);
  }

  highest(field: 'open' | 'high' | 'low' | 'close', n: number): number | null {
    return extremeValues(this.history(field, n), n, Math.max);
  }

  lowest(field: 'open' | 'high' | 'low' | 'close', n: number): number | null {
    return extremeValues(this.history(field, n), n, Math.min);
  }

  avgAmount(n: number): number | null {
    return avgField(this.bars(n), n, (bar) => bar.amount);
  }

  avgVol(n: number): number | null {
    return avgField(this.bars(n), n, (bar) => bar.vol);
  }
}

export interface CodeStrategy<Params extends StrategyParams = StrategyParams> {
  name?: string;
  /** Finite numeric or non-empty categorical defaults exposed to scans. */
  params?: Params;
  /** Precomputed factor columns to preload (price-window signals like mom/rev/vol). */
  factors?: string[];
  /** Instruments to preload bar series for up front (per-instrument systems read bars()/price()). */
  watch?: string[];
  /** Logical continuous or actual stock-index futures codes. */
  futures?: string[];
  /** Initial capital split for a mixed stock/futures strategy. */
  accounts?: StrategyAccounts;
  onBar(ctx: StrategyCtx<Params>): void | Promise<void>;
}

/** Today's universe as a chainable view over codes — filter, rank, take a slice. Each step returns a new
 * Universe (immutable); the terminal `top`/`codes` returns plain string[]. The candidate pool the engine
 * recomputes each bar (cf. industry "universe selection"): `(await ctx.universe('000300.SH'))
 * .minListDays(365).rankBy(b => 1/b.peTtm!).top(0.1)`. The index restriction (if any) was pushed into the
 * data load; `where`/`rankBy`/etc. refine the loaded panel in memory. */
export class Universe {
  constructor(
    private readonly ctx: BarContext,
    private readonly list: string[],
  ) {}

  /** Keep codes whose today-row passes the predicate. */
  where(predicate: (bar: BarRow, code: string) => boolean): Universe {
    return new Universe(
      this.ctx,
      this.list.filter((code) => {
        const bar = this.ctx.bar(code);
        return bar != null && predicate(bar, code);
      }),
    );
  }

  /** Keep codes listed at least `days` calendar days (point-in-time stock age). */
  minListDays(days: number): Universe {
    return new Universe(
      this.ctx,
      this.list.filter((code) => {
        const age = this.ctx.listDays(code);
        return age == null || age >= days;
      }),
    );
  }

  /** Drop the bottom `fraction` by `score` (e.g. liquidity: `dropBottom(0.25, b => b.turnoverRate ?? 0)`). */
  dropBottom(fraction: number, score: (bar: BarRow, code: string) => number): Universe {
    const scored = this.list.map((code) => ({ code, value: this.scoreOrBottom(code, score) }));
    scored.sort((lower, higher) => lower.value - higher.value);
    return new Universe(
      this.ctx,
      scored.slice(Math.floor(scored.length * fraction)).map((entry) => entry.code),
    );
  }

  /** Rank by a score (codes scoring null are dropped). `direction` 'desc' = highest first (default). */
  rankBy(
    score: (bar: BarRow, code: string) => number | null,
    direction: 'desc' | 'asc' = 'desc',
  ): Universe {
    const scored = this.list
      .map((code) => {
        const bar = this.ctx.bar(code);
        return { code, value: bar != null ? score(bar, code) : null };
      })
      .filter(
        (entry): entry is { code: string; value: number } =>
          entry.value != null && Number.isFinite(entry.value),
      );
    scored.sort((lower, higher) =>
      direction === 'desc' ? higher.value - lower.value : lower.value - higher.value,
    );
    return new Universe(
      this.ctx,
      scored.map((entry) => entry.code),
    );
  }

  /** Take the leading slice: a fraction when `n < 1` (0.1 = top decile, min 1), else a count. */
  top(n: number): string[] {
    // n < 1 → take a fraction (0.1 = top 10%, at least 1); n ≥ 1 → take a count
    const count = n < 1 ? Math.max(1, Math.floor(this.list.length * n)) : Math.floor(n);
    return this.list.slice(0, count);
  }

  /** The current codes (after any chained steps). */
  codes(): string[] {
    return this.list;
  }

  get length(): number {
    return this.list.length;
  }

  // Score a code via its today-row; a code with no row scores -Infinity so it sorts to the bottom.
  private scoreOrBottom(code: string, score: (bar: BarRow, code: string) => number): number {
    const bar = this.ctx.bar(code);
    return bar != null ? score(bar, code) : -Infinity;
  }
}

/** Identity-with-types factory for a code strategy; wraps onBar so it receives the enriched ctx. The
 * code loader injects THIS as the `defineStrategy` ambient. */
export function defineStrategy<const Params extends StrategyParams = Record<string, never>>(
  s: CodeStrategy<Params>,
): Strategy {
  const strategy: Strategy = {
    name: s.name ?? '未命名策略',
    params: normalizeStrategyParams(s.params),
    factors: s.factors,
    watch: s.watch,
    futures: s.futures,
    accounts: s.accounts,
    onBar: (core: BarContext) => s.onBar(enrich(core, strategy.params as Params)),
  };
  return strategy;
}

/** Layer the SDK helpers onto the engine's per-bar core ctx. */
export function enrich<Params extends StrategyParams = StrategyParams>(
  ctx: BarContext,
  params = {} as Params,
): StrategyCtx<Params> {
  const enriched = ctx as StrategyCtx<Params>;
  Object.defineProperty(enriched, 'params', {
    configurable: true,
    enumerable: true,
    value: Object.freeze({ ...params }),
  });
  enriched.period = (schedule) => periodKey(ctx.date, schedule);
  // The index restriction is pushed into the data load (loadCrossSection only reads those rows), not
  // filtered in memory here — so CSI 300 reads ~300 rows, not the full ~5370. See engine/data crossSection.
  enriched.universe = async (indexCode?: string) =>
    new Universe(ctx, await ctx.loadCrossSection(indexCode));
  enriched.equalWeight = (codes) => {
    const weight = codes.length ? 1 / codes.length : 0;
    const targets: Record<string, number> = {};
    for (const code of codes) {
      targets[code] = weight;
    }
    ctx.setHoldings(targets);
  };
  enriched.atrUnits = (code, riskPct, atrPeriod = 20) => {
    const window = Math.floor(atrPeriod);
    if (!(riskPct > 0) || window <= 0) {
      return 0;
    }
    const atr = atrBars(ctx.bars(code, window + 1), window);
    return atr == null || atr <= 0 ? 0 : Math.floor((ctx.value * riskPct) / atr);
  };
  enriched.volTargetWeights = (codes, lookback = 20) => {
    const window = Math.floor(lookback);
    if (window < 2) {
      return new Map();
    }
    const inverseVol = new Map<string, number>();
    for (const code of codes) {
      const closes = ctx.history(code, 'close', window + 1);
      if (closes.length < window + 1) {
        continue;
      }
      const returns = closes
        .slice(1)
        .map((close, index) => close / closes[index] - 1)
        .filter(Number.isFinite);
      if (returns.length !== window) {
        continue;
      }
      const volatility = sampleDeviation(returns);
      if (volatility > 0) {
        inverseVol.set(code, 1 / volatility);
      }
    }
    const total = [...inverseVol.values()].reduce((sum, value) => sum + value, 0);
    return new Map([...inverseVol].map(([code, value]) => [code, value / total]));
  };
  enriched.weekly = (code) => new ResampledSeries(ctx, code, 'weekly');
  enriched.monthly = (code) => new ResampledSeries(ctx, code, 'monthly');
  enriched.sma = (code, n) => {
    return smaValues(ctx.history(code, 'close', n), n);
  };
  enriched.ema = (code, n) => {
    return emaValues(ctx.history(code, 'close', n * 4), n);
  };
  enriched.highest = (code, field, n) => {
    return extremeValues(ctx.history(code, field, n), n, Math.max);
  };
  enriched.lowest = (code, field, n) => {
    return extremeValues(ctx.history(code, field, n), n, Math.min);
  };
  enriched.atr = (code, n) => {
    return atrBars(ctx.bars(code, n + 1), n);
  };
  enriched.avgAmount = (code, n) => avgField(ctx.bars(code, n), n, (bar) => bar.amount);
  enriched.avgVol = (code, n) => avgField(ctx.bars(code, n), n, (bar) => bar.vol);
  return enriched;
}

export function applyStrategyParamOverrides(
  strategy: Strategy,
  overrides?: Record<string, StrategyParamValue>,
): void {
  if (!overrides) {
    return;
  }
  const declared = strategy.params ?? {};
  const merged = { ...declared };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in declared)) {
      throw new Error(`unknown strategy parameter: ${key}`);
    }
    if (typeof value !== typeof declared[key]) {
      throw new Error(`strategy parameter ${key} override must match its declared type`);
    }
    if (!validParamValue(value)) {
      throw new Error(`strategy parameter ${key} must be a finite number or non-empty string`);
    }
    merged[key] = value;
  }
  strategy.params = merged;
}

function normalizeStrategyParams(params?: StrategyParams): StrategyParams {
  const normalized: StrategyParams = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (!key.trim() || !validParamValue(value)) {
      throw new Error('strategy params must use non-empty keys and finite numbers or strings');
    }
    normalized[key] = value;
  }
  return normalized;
}

function validParamValue(value: StrategyParamValue): boolean {
  return typeof value === 'number'
    ? Number.isFinite(value)
    : value.trim().length > 0 && value.length <= 100;
}

/** Mean of a per-bar field over the window, or null if fewer than n valid values. */
function avgField(
  bars: { amount: number | null; vol: number | null }[],
  n: number,
  pick: (bar: { amount: number | null; vol: number | null }) => number | null,
): number | null {
  const values = bars.map(pick).filter((value): value is number => value != null);
  return values.length < n ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function smaValues(values: number[], n: number): number | null {
  return n > 0 && values.length >= n
    ? values.slice(-n).reduce((sum, value) => sum + value, 0) / n
    : null;
}

function emaValues(values: number[], n: number): number | null {
  if (n <= 0 || values.length < n) {
    return null;
  }
  const alpha = 2 / (n + 1);
  let ema = values[0];
  for (const value of values.slice(1)) {
    ema = value * alpha + ema * (1 - alpha);
  }
  return ema;
}

function extremeValues(
  values: number[],
  n: number,
  pick: (...values: number[]) => number,
): number | null {
  return n > 0 && values.length >= n ? pick(...values.slice(-n)) : null;
}

function atrBars(bars: OhlcBar[], n: number): number | null {
  if (n <= 0 || bars.length < n + 1) {
    return null;
  }
  let trueRangeSum = 0;
  for (let barIndex = bars.length - n; barIndex < bars.length; barIndex++) {
    const bar = bars[barIndex];
    const prevClose = bars[barIndex - 1].adjClose;
    trueRangeSum += Math.max(
      bar.adjHigh - bar.adjLow,
      Math.abs(bar.adjHigh - prevClose),
      Math.abs(bar.adjLow - prevClose),
    );
  }
  return trueRangeSum / n;
}

function ohlcField(bar: OhlcBar, field: 'open' | 'high' | 'low' | 'close'): number {
  return field === 'open'
    ? bar.adjOpen
    : field === 'high'
      ? bar.adjHigh
      : field === 'low'
        ? bar.adjLow
        : bar.adjClose;
}

function sampleDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1),
  );
}

/** Period bucket for a schedule — a new key means a new period (rebalance boundary). */
export function periodKey(date: string, schedule: Schedule): string {
  if (schedule === 'monthly') {
    return date.slice(0, 6);
  } // YYYYMM
  if (schedule === 'weekly') {
    return isoWeekKey(date);
  }
  return date; // daily: each trading day is its own key
}
