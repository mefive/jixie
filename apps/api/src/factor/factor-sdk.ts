import type { FactorBar } from '@jixie/shared';

/**
 * The factor authoring surface (mirrors the strategy SDK's defineStrategy) — shared by user factors
 * AND the built-in presets (which are seeded as read-only code rows, 设计:factor-to-strategy.md
 * Step 1b). A factor is a cross-sectional expression over one stock's point-in-time bar; declaring
 * `window` additionally unlocks `ctx.history` (hfq close window) at the cost of the slower
 * per-stock-series path. Return the raw value, or null to exclude the stock this period — don't
 * pre-negate for direction; the analysis IC sign reveals it.
 * An import-free ambient: `export default defineFactor({ name, window?, compute(bar, ctx) { … } })`.
 */
export interface FactorCtx {
  /** 后复权收盘价窗口(close × adj_factor),`[最旧 … 当天]` 共 n 个;历史不足 n 时返回 []。
   * 仅在因子声明了 `window`(≥ n)时可用,否则抛错(声明式预载,不做隐式检测)。 */
  history(n: number): number[];
  /** 窗口对应的交易日(YYYYMMDD),与 history(n) 逐位对齐 — 用于停牌间隙检查等。 */
  history(n: number, field: 'date'): string[];
}

export interface CustomFactor {
  name: string;
  /** 所需历史长度(交易日数,含当天)。声明后 compute 才能用 ctx.history(n ≤ window)。 */
  window?: number;
  compute: (bar: FactorBar, ctx: FactorCtx) => number | null;
}

/** Injected authoring entry — identity, so the compiler can capture the exported object. */
export function defineFactor(factor: CustomFactor): CustomFactor {
  return factor;
}
