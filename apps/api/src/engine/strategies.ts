import type { Strategy } from './types.js';

/** Identity helper — gives a strategy object its type + a place to hang a name. */
export function defineStrategy(s: Strategy): Strategy {
  return s;
}

/**
 * Config-driven factor strategy (the bridge to a future web UI: these options are exactly what a
 * form would collect). Rebalances on the first trading day of each month — detected in onBar itself
 * by watching for a month change (the engine has no built-in schedule). Ranks the universe by
 * `factor` and equal-weights the top/bottom `quantile` slice.
 *   side 'low'  → hold the lowest-factor names (e.g. low-volatility anomaly)
 *   side 'high' → hold the highest-factor names
 */
export function factorStrategy(opts: {
  factor: string;
  side: 'low' | 'high';
  quantile: number; // 0.1 = top/bottom decile
  name?: string;
}): Strategy {
  let lastMonth = '';
  return {
    name: opts.name ?? `${opts.factor}-${opts.side}-q${opts.quantile}`,
    onBar(ctx) {
      const month = ctx.date.slice(0, 6);
      if (month === lastMonth) return; // already rebalanced this month
      lastMonth = month;

      const ranked = ctx
        .universe()
        .map((c) => ({ c, v: ctx.factor(opts.factor, c) }))
        .filter((x): x is { c: string; v: number } => x.v != null)
        .sort((a, b) => a.v - b.v); // ascending by factor value
      if (ranked.length < 20) return;

      const k = Math.max(1, Math.floor(ranked.length * opts.quantile));
      const picks = opts.side === 'low' ? ranked.slice(0, k) : ranked.slice(-k);
      const w = 1 / picks.length;
      const targets: Record<string, number> = {};
      for (const p of picks) targets[p.c] = w;
      ctx.setHoldings(targets);
    },
  };
}
