import type { BarContext, BarRow, Strategy } from '../../engine/types.js';

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

/** What user code sees each bar: the engine primitives (BarContext) + the SDK helpers below. */
export interface StrategyCtx extends BarContext {
  /** Period key for today on a schedule — compare to your own `let last` to fire once per period:
   * `if (ctx.period('monthly') === last) return; last = ctx.period('monthly');` */
  period(schedule: Schedule): string;
  /** Today's tradable universe as a chainable selection (loads the cross-section; bar() valid after).
   * Pass an index code (e.g. '000300.SH' 沪深300) to restrict to its point-in-time constituents. */
  select(indexCode?: string): Promise<Selection>;
  /** Equal-weight the given codes (a target-book rebalance at next open). */
  equalWeight(codes: string[]): void;

  // —— 内置技术指标(都需要该票的 K 线已加载:watch 预载 或 ensureBars;数据不足返 null)——
  /** n 日简单均线(最近 n 根收盘均值)。 */
  sma(code: string, n: number): number | null;
  /** n 日指数均线。 */
  ema(code: string, n: number): number | null;
  /** n 日 ATR(平均真实波幅,需 n+1 根)。 */
  atr(code: string, n: number): number | null;
  /** 最近 n 根在某字段上的最高(唐奇安上轨)。 */
  highest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null;
  /** 最近 n 根在某字段上的最低(唐奇安下轨)。 */
  lowest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null;
  /** n 日平均成交额(千元)—— 流动性 / 滑点门。 */
  avgAmount(code: string, n: number): number | null;
  /** n 日平均成交量(手)。 */
  avgVol(code: string, n: number): number | null;
}

export interface CodeStrategy {
  name?: string;
  /** Precomputed factor columns to preload (price-window signals like mom/rev/vol). */
  factors?: string[];
  /** Instruments to preload bar series for up front (per-instrument systems read bars()/price()). */
  watch?: string[];
  onBar(ctx: StrategyCtx): void | Promise<void>;
}

/** A chainable view over a set of codes for today — filter, rank, take a slice. Each step returns a new
 * Selection (immutable); the terminal `top`/`codes` returns plain string[]. Cross-section selection
 * without the IR: `(await ctx.select()).minListDays(365).rankBy(b => 1/b.peTtm!).top(0.1)`. */
export class Selection {
  constructor(
    private readonly ctx: BarContext,
    private readonly list: string[],
  ) {}

  /** Keep codes whose today-row passes the predicate. */
  where(pred: (bar: BarRow, code: string) => boolean): Selection {
    return new Selection(
      this.ctx,
      this.list.filter((c) => {
        const b = this.ctx.bar(c);
        return b != null && pred(b, c);
      }),
    );
  }

  /** Keep codes listed at least `days` calendar days (point-in-time stock age). */
  minListDays(days: number): Selection {
    return new Selection(
      this.ctx,
      this.list.filter((c) => {
        const age = this.ctx.listDays(c);
        return age == null || age >= days;
      }),
    );
  }

  /** Drop the bottom `frac` by `key` (e.g. liquidity: `dropBottom(0.25, b => b.turnoverRate ?? 0)`). */
  dropBottom(frac: number, key: (bar: BarRow, code: string) => number): Selection {
    const scored = this.list.map((c) => ({ c, k: this.keyOf(c, key) }));
    scored.sort((a, b) => a.k - b.k);
    return new Selection(this.ctx, scored.slice(Math.floor(scored.length * frac)).map((x) => x.c));
  }

  /** Rank by a score (codes scoring null are dropped). `dir` 'desc' = highest first (default). */
  rankBy(score: (bar: BarRow, code: string) => number | null, dir: 'desc' | 'asc' = 'desc'): Selection {
    const scored = this.list
      .map((c) => {
        const b = this.ctx.bar(c);
        return { c, s: b != null ? score(b, c) : null };
      })
      .filter((x): x is { c: string; s: number } => x.s != null && Number.isFinite(x.s));
    scored.sort((a, b) => (dir === 'desc' ? b.s - a.s : a.s - b.s));
    return new Selection(this.ctx, scored.map((x) => x.c));
  }

  /** Take the leading slice: a fraction when `n < 1` (0.1 = top decile, min 1), else a count. */
  top(n: number): string[] {
    const k = n < 1 ? Math.max(1, Math.floor(this.list.length * n)) : Math.floor(n);
    return this.list.slice(0, k);
  }

  /** The current codes (after any chained steps). */
  codes(): string[] {
    return this.list;
  }

  get length(): number {
    return this.list.length;
  }

  private keyOf(code: string, key: (bar: BarRow, code: string) => number): number {
    const b = this.ctx.bar(code);
    return b != null ? key(b, code) : -Infinity; // missing → sorts to the bottom (gets dropped)
  }
}

/** Identity-with-types factory for a code strategy; wraps onBar so it receives the enriched ctx. The
 * code loader injects THIS as the `defineStrategy` ambient. */
export function defineStrategy(s: CodeStrategy): Strategy {
  return {
    name: s.name ?? '未命名策略',
    factors: s.factors,
    watch: s.watch,
    onBar: (core: BarContext) => s.onBar(enrich(core)),
  };
}

/** Layer the SDK helpers onto the engine's per-bar core ctx. */
export function enrich(ctx: BarContext): StrategyCtx {
  const rich = ctx as StrategyCtx;
  rich.period = (schedule) => periodKey(ctx.date, schedule);
  rich.select = async (indexCode?: string) => {
    const all = await ctx.universe();
    if (!indexCode) return new Selection(ctx, all);
    const members = new Set(await ctx.indexMembers(indexCode));
    return new Selection(ctx, all.filter((c) => members.has(c)));
  };
  rich.equalWeight = (codes) => {
    const w = codes.length ? 1 / codes.length : 0;
    const targets: Record<string, number> = {};
    for (const c of codes) targets[c] = w;
    ctx.setHoldings(targets);
  };
  rich.sma = (code, n) => {
    const w = ctx.history(code, 'close', n);
    return w.length < n ? null : w.reduce((a, b) => a + b, 0) / n;
  };
  rich.ema = (code, n) => {
    const w = ctx.history(code, 'close', n * 4); // extra lookback to warm up the EMA
    if (w.length < n) return null;
    const k = 2 / (n + 1);
    let e = w[0];
    for (let i = 1; i < w.length; i++) e = w[i] * k + e * (1 - k);
    return e;
  };
  rich.highest = (code, field, n) => {
    const w = ctx.history(code, field, n);
    return w.length < n ? null : Math.max(...w);
  };
  rich.lowest = (code, field, n) => {
    const w = ctx.history(code, field, n);
    return w.length < n ? null : Math.min(...w);
  };
  rich.atr = (code, n) => {
    const bars = ctx.bars(code, n + 1);
    if (bars.length < n + 1) return null;
    let sum = 0;
    for (let i = bars.length - n; i < bars.length; i++) {
      const pc = bars[i - 1].adjClose;
      sum += Math.max(bars[i].adjHigh - bars[i].adjLow, Math.abs(bars[i].adjHigh - pc), Math.abs(bars[i].adjLow - pc));
    }
    return sum / n;
  };
  rich.avgAmount = (code, n) => avgField(ctx.bars(code, n), n, (b) => b.amount);
  rich.avgVol = (code, n) => avgField(ctx.bars(code, n), n, (b) => b.vol);
  return rich;
}

/** Mean of a per-bar field over the window, or null if fewer than n valid values. */
function avgField(bars: { amount: number | null; vol: number | null }[], n: number, pick: (b: { amount: number | null; vol: number | null }) => number | null): number | null {
  const vals = bars.map(pick).filter((x): x is number => x != null);
  return vals.length < n ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Period bucket for a schedule — a new key means a new period (rebalance boundary). */
export function periodKey(date: string, schedule: Schedule): string {
  if (schedule === 'monthly') return date.slice(0, 6);
  if (schedule === 'weekly') {
    const epochDay =
      Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) / 86_400_000;
    return String(Math.floor(epochDay / 7));
  }
  return date;
}
