import type { StrategyCapabilities } from './capabilities.js';
import type { BarRow, Universe as UniverseContract } from '@jixie/shared/sdk/strategy/contract';

/** Today's universe as a chainable view over codes — filter, rank, take a slice. Each step returns a new
 * Universe (immutable); the terminal `top`/`codes` returns plain string[]. The candidate pool the engine
 * recomputes each bar (cf. industry "universe selection"): `(await ctx.universe('000300.SH'))
 * .minListDays(365).rankBy(b => 1/b.peTtm!).top(0.1)`. The index restriction (if any) was pushed into the
 * data load; `where`/`rankBy`/etc. refine the loaded panel in memory. */
export class Universe implements UniverseContract {
  constructor(
    private readonly capabilities: StrategyCapabilities,
    private readonly list: string[],
  ) {}

  /** Keep codes whose today-row passes the predicate. */
  where(predicate: (bar: BarRow, code: string) => boolean): Universe {
    return new Universe(
      this.capabilities,
      this.list.filter((code) => {
        const bar = this.capabilities.bar(code);
        return bar != null && predicate(bar, code);
      }),
    );
  }

  /** Keep codes listed at least `days` calendar days (point-in-time stock age). */
  minListDays(days: number): Universe {
    return new Universe(
      this.capabilities,
      this.list.filter((code) => {
        const age = this.capabilities.listDays(code);
        return age == null || age >= days;
      }),
    );
  }

  /** Drop the bottom `fraction` by `score` (e.g. liquidity: `dropBottom(0.25, b => b.turnoverRate ?? 0)`). */
  dropBottom(fraction: number, score: (bar: BarRow, code: string) => number): Universe {
    const scored = this.list.map((code) => ({ code, value: this.scoreOrBottom(code, score) }));
    scored.sort((lower, higher) => lower.value - higher.value);
    return new Universe(
      this.capabilities,
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
        const bar = this.capabilities.bar(code);
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
      this.capabilities,
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
    const bar = this.capabilities.bar(code);
    return bar != null ? score(bar, code) : -Infinity;
  }
}
