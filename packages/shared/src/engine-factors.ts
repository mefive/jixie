/**
 * Registry of the factor columns the BACKTEST ENGINE can serve through ctx.factor() — the single
 * source (like sdk-reference.ts) for: the engine's time semantics, the Monaco dts FactorKey union,
 * and the codegen prompt's factor list. Distinct from the factor-RESEARCH catalog (builtin-factors):
 * research factors are analyzed on month-end cross-sections; these are read live inside a strategy.
 *
 * Time semantics are a DECLARED property of the factor, not a call parameter: ctx.factor() never
 * takes a date (ctx is always "today", preventing look-ahead); how a stored value maps onto "today"
 * follows the factor's declared kind:
 *   - flow: a per-day quantity (net inflow). Exact day only — yesterday's inflow must never pass as
 *     today's; null on days without data, never carried forward. (Same semantics as ctx.lhbNet.)
 *   - level: a state (valuation, latest published report). "Latest value ≤ today" is the correct
 *     reading; carried forward at most `dataFreq`'s lookback cap.
 */

export interface EngineFactorDef {
  key: string;
  kind: 'flow' | 'level';
  /** The data's inherent frequency — bounds how far back a `level` as-of read may reach. */
  dataFreq: 'daily' | 'monthly';
  /** column = a stored table column the engine preloads; derived = computed from prices on the fly. */
  source: 'column' | 'derived';
  zh: string;
  en: string;
  /** Exact fragment for the codegen prompt's factor list; omitted → derived from `key`. */
  prompt?: string;
}

// `as const` keeps every `key` a literal type — FactorKey below must be a literal union.
export const ENGINE_FACTORS = [
  {
    key: 'mf_net_main',
    kind: 'flow',
    dataFreq: 'daily',
    source: 'column',
    zh: '主力净流入(万元,+流入/−流出;当日精确值,无数据返 null)',
    en: 'Main-force (large + extra-large orders) net inflow (10k CNY; exact day, null when absent)',
    prompt: '**mf_net_main** = main-force (large + extra-large orders) net amount',
  },
  {
    key: 'mf_net_total',
    kind: 'flow',
    dataFreq: 'daily',
    source: 'column',
    zh: '全单净额(万元,+流入/−流出;当日精确值,无数据返 null)',
    en: 'Net amount across all order sizes (10k CNY; exact day, null when absent)',
    prompt: '**mf_net_total** = net amount across all order sizes',
  },
] as const satisfies readonly EngineFactorDef[];

/** Literal union of the engine-served factor keys (custom factors ride on `custom:<id>` instead). */
export type EngineFactorKey = (typeof ENGINE_FACTORS)[number]['key'];

/** A user-authored factor referenced from a strategy: `custom:` + the Factor row's id. */
export const CUSTOM_FACTOR_PREFIX = 'custom:';

export function isCustomFactorKey(key: string): boolean {
  return key.startsWith(CUSTOM_FACTOR_PREFIX);
}

export function customFactorId(key: string): string {
  return key.slice(CUSTOM_FACTOR_PREFIX.length);
}
