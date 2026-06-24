import type { BacktestConfig, CrossSectionIR, Schedule, StrategyIR, UniverseFilter } from '@jixie/shared';
import { runStrategy } from '../../engine/run.js';
import type { BacktestResult, BarRow, Strategy } from '../../engine/types.js';
import { evalExpr, type ExprScope } from './expr.js';

/** Period bucket for the schedule — a rebalance happens when the bucket changes. */
function periodKey(date: string, schedule: Schedule): string {
  if (schedule === 'monthly') return date.slice(0, 6);
  if (schedule === 'weekly') {
    const epochDay =
      Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) / 86_400_000;
    return String(Math.floor(epochDay / 7));
  }
  return date; // daily
}

const FIELD = (bar: BarRow, name: string): number | null =>
  (bar as unknown as Record<string, number | null>)[name] ?? null;

/** Compile a cross-sectional IR into an engine Strategy: on each schedule boundary, filter the
 * universe, score + rank it, and equal-weight the chosen quantile via setHoldings. */
function interpretCrossSection(ir: CrossSectionIR): Strategy {
  const minListDays = ir.universe.filters.find((f) => f.kind === 'minListDays')?.days;
  const dropPct = ir.universe.filters.find((f) => f.kind === 'dropIlliquidPct')?.pct;
  const fieldFilters = ir.universe.filters.filter(
    (f): f is Extract<UniverseFilter, { kind: 'field' }> => f.kind === 'field',
  );
  let lastKey = '';

  return {
    name: `ir:${ir.type}`,
    factors: ir.factors,
    async onBar(ctx) {
      const key = periodKey(ctx.date, ir.schedule);
      if (key === lastKey) return; // not a rebalance boundary
      lastKey = key;

      const codes = await ctx.universe();
      let cands: { code: string; score: number; turnover: number }[] = [];
      for (const code of codes) {
        const bar = ctx.bar(code);
        if (!bar) continue;
        if (minListDays != null) {
          const age = ctx.listDays(code);
          if (age != null && age < minListDays) continue;
        }
        if (!fieldFilters.every((f) => cmp(FIELD(bar, f.field), f.op, f.value))) continue;

        const scope: ExprScope = { field: (n) => FIELD(bar, n), factor: (n) => ctx.factor(n, code) };
        const score = evalExpr(ir.score, scope);
        if (!Number.isFinite(score)) continue;
        cands.push({ code, score, turnover: bar.turnoverRate ?? 0 });
      }
      if (cands.length < 20) return;

      if (dropPct != null && dropPct > 0) {
        cands.sort((a, b) => a.turnover - b.turnover);
        cands = cands.slice(Math.floor((cands.length * dropPct) / 100));
      }

      cands.sort((a, b) => a.score - b.score); // ascending
      const k = Math.max(1, Math.floor(cands.length * ir.pick.quantile));
      const picks = ir.pick.side === 'low' ? cands.slice(0, k) : cands.slice(-k);
      const w = 1 / picks.length;
      const targets: Record<string, number> = {};
      for (const p of picks) targets[p.code] = w;
      ctx.setHoldings(targets);
    },
  };
}

function cmp(v: number | null, op: string, value: number): boolean {
  if (v == null || !Number.isFinite(v)) return false;
  return op === '>' ? v > value : op === '>=' ? v >= value : op === '<' ? v < value : v <= value;
}

/** Compile any strategy IR into an engine Strategy. */
export function interpretStrategy(ir: StrategyIR): Strategy {
  switch (ir.type) {
    case 'cross_section':
      return interpretCrossSection(ir);
    default:
      throw new Error(`unsupported strategy IR type: ${(ir as { type: string }).type}`);
  }
}

/** Run a full backtest from an IR config. This is what the API route and demo scripts call. */
export async function runBacktestConfig(config: BacktestConfig): Promise<BacktestResult> {
  const strategy = interpretStrategy(config.strategy);
  return runStrategy({
    start: config.start,
    end: config.end,
    initialCash: config.initialCash,
    cost: config.cost,
    strategy,
  });
}
