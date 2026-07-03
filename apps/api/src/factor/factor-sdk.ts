import type { FactorBar } from '@jixie/shared';

/**
 * The custom-factor authoring surface (mirrors the strategy SDK's defineStrategy). A user factor is a
 * cross-sectional expression over one stock's point-in-time bar (估值 / 规模 / 流动性). Return the raw
 * value, or null to exclude the stock this period — don't pre-negate for direction; the analysis IC
 * sign reveals it. An import-free ambient: `export default defineFactor({ name, compute(bar) { … } })`.
 */
export interface CustomFactor {
  name: string;
  compute: (bar: FactorBar) => number | null;
}

/** Injected authoring entry — identity, so the compiler can capture the exported object. */
export function defineFactor(factor: CustomFactor): CustomFactor {
  return factor;
}
