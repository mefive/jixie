import type { FactorBar } from '@jixie/shared';

/**
 * The factor authoring surface (mirrors the strategy SDK's defineStrategy) — shared by user factors
 * AND the built-in presets (which are seeded as read-only code rows, design: factor-to-strategy.md
 * Step 1b). A factor is a cross-sectional expression over one stock's point-in-time bar; declaring
 * `window` additionally unlocks `ctx.history` (hfq close window) at the cost of the slower
 * per-stock-series path. Return the raw value, or null to exclude the stock this period — don't
 * pre-negate for direction; the analysis IC sign reveals it.
 * An import-free ambient: `export default defineFactor({ name, window?, compute(bar, ctx) { … } })`.
 */
export interface FactorCtx {
  /** After-adjustment (hfq) close window (close × adj_factor), `[oldest … current day]`, n values total;
   * returns [] when history is shorter than n.
   * Available only when the factor declares `window` (≥ n); throws otherwise (declarative preload, no implicit detection). */
  history(n: number): number[];
  /** The window's trading days (YYYYMMDD), aligned position-by-position with history(n) — used for suspension-gap checks etc. */
  history(n: number, field: 'date'): string[];
}

export interface CustomFactor {
  name: string;
  /** Required history length (number of trading days, including the current day). Once declared, compute may use ctx.history(n ≤ window). */
  window?: number;
  compute: (bar: FactorBar, ctx: FactorCtx) => number | null;
}

/** Injected authoring entry — identity, so the compiler can capture the exported object. */
export function defineFactor(factor: CustomFactor): CustomFactor {
  return factor;
}
