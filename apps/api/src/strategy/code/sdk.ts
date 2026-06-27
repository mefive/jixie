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
  /** Today's tradable universe as a chainable selection (loads the cross-section; bar() valid after). */
  select(): Promise<Selection>;
  /** Equal-weight the given codes (a target-book rebalance at next open). */
  equalWeight(codes: string[]): void;
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
  rich.select = async () => new Selection(ctx, await ctx.universe());
  rich.equalWeight = (codes) => {
    const w = codes.length ? 1 / codes.length : 0;
    const targets: Record<string, number> = {};
    for (const c of codes) targets[c] = w;
    ctx.setHoldings(targets);
  };
  return rich;
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
