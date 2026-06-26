import type {
  BacktestConfig,
  PipelineIR,
  Schedule,
  SizingMethod,
  Stage,
  StrategyIR,
  UniverseFilter,
} from '@jixie/shared';
import { runStrategy } from '../../engine/run.js';
import type { BacktestResult, BarContext, BarRow, Strategy } from '../../engine/types.js';
import { evalExpr, type ExprScope } from './expr.js';
import { evalCondition, maxWindow } from './ind-expr.js';

type StageOf<K extends Stage['kind']> = Extract<Stage, { kind: K }>;

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

function cmp(v: number | null, op: string, value: number): boolean {
  if (v == null || !Number.isFinite(v)) return false;
  return op === '>' ? v > value : op === '>=' ? v >= value : op === '<' ? v < value : v <= value;
}

// —— Pipeline interpreter: fold the stages into one onBar that runs on the single `schedule` clock ——

/** filter stage: hard predicates (minListDays / dropIlliquidPct / field comparisons), point-in-time. */
function applyFilter(filters: UniverseFilter[], codes: string[], ctx: BarContext): string[] {
  const minListDays = filters.find((f) => f.kind === 'minListDays')?.days;
  const dropPct = filters.find((f) => f.kind === 'dropIlliquidPct')?.pct;
  const fieldFilters = filters.filter(
    (f): f is Extract<UniverseFilter, { kind: 'field' }> => f.kind === 'field',
  );

  let kept: { code: string; bar: BarRow }[] = [];
  for (const code of codes) {
    const bar = ctx.bar(code);
    if (!bar) continue;
    if (minListDays != null) {
      const age = ctx.listDays(code);
      if (age != null && age < minListDays) continue;
    }
    if (!fieldFilters.every((f) => cmp(FIELD(bar, f.field), f.op, f.value))) continue;
    kept.push({ code, bar });
  }
  if (dropPct != null && dropPct > 0) {
    kept.sort((a, b) => (a.bar.turnoverRate ?? 0) - (b.bar.turnoverRate ?? 0));
    kept = kept.slice(Math.floor((kept.length * dropPct) / 100));
  }
  return kept.map((k) => k.code);
}

/** select stage: score each code cross-sectionally, rank, keep the chosen tail (quantile or topN). */
function applySelect(select: StageOf<'select'>, codes: string[], ctx: BarContext): string[] {
  const cands: { code: string; score: number }[] = [];
  for (const code of codes) {
    const bar = ctx.bar(code);
    if (!bar) continue;
    const scope: ExprScope = { field: (n) => FIELD(bar, n), factor: (n) => ctx.factor(n, code) };
    const score = evalExpr(select.score, scope);
    if (!Number.isFinite(score)) continue;
    cands.push({ code, score });
  }
  if (cands.length === 0) return [];
  cands.sort((a, b) => a.score - b.score); // ascending
  const n =
    select.pick.by === 'topN'
      ? Math.min(Math.floor(select.pick.value), cands.length)
      : Math.max(1, Math.floor(cands.length * select.pick.value));
  const picks = select.side === 'low' ? cands.slice(0, n) : cands.slice(-n);
  return picks.map((c) => c.code);
}

/** Shares to buy on a fresh entry, per the sizing method (equityPct/kSlots → a fraction of equity;
 * equal → split equity across the current candidate pool). Timing entries are imperative buy-and-hold
 * (no interim rebalance), so each entry is sized once here. */
function entryShares(method: SizingMethod, equity: number, px: number, poolSize: number): number {
  if (px <= 0) return 0;
  const frac =
    method.kind === 'equityPct'
      ? method.pct
      : method.kind === 'kSlots'
        ? 1 / Math.max(1, method.k)
        : 1 / Math.max(1, poolSize); // equal
  return Math.floor((frac * equity) / px);
}

/** timing stage (imperative): per-instrument flat↔holding state machine. Exit ALL current holdings
 * whose exit fires (even ones that fell out of the eligible set — gate semantics; `hard` also drops
 * any deselected holding). Then enter eligible flats whose entry fires, sizing each via `sizing`.
 * Buy-and-hold between entry and exit — no interim rebalancing of an open position. */
async function applyTiming(
  timing: StageOf<'timing'>,
  eligible: string[],
  sizing: SizingMethod,
  needBars: number,
  ctx: BarContext,
): Promise<void> {
  const eligibleSet = new Set(eligible);
  const heldNow = ctx.positions().map((p) => p.code);
  await ctx.ensureBars([...new Set([...eligible, ...heldNow])]); // lazy-load the dynamic set's bars

  // exits: every current holding
  let openCount = heldNow.length;
  for (const code of heldNow) {
    const bars = ctx.bars(code, needBars);
    const exited = bars.length >= 2 && evalCondition(timing.exit, { bars });
    const hardDrop = timing.membership === 'hard' && !eligibleSet.has(code);
    if (exited || hardDrop) {
      ctx.exit(code);
      openCount--;
    }
  }
  // entries: eligible flats (respect a kSlots cap on concurrent positions)
  const cap = sizing.kind === 'kSlots' ? sizing.k : Infinity;
  for (const code of eligible) {
    if (openCount >= cap) break;
    if (ctx.shares(code) > 0) continue; // already held
    const bars = ctx.bars(code, needBars);
    if (bars.length < 2 || !evalCondition(timing.entry, { bars })) continue;
    const px = bars[bars.length - 1].adjClose;
    const shares = entryShares(sizing, ctx.value, px, eligible.length);
    if (shares > 0) {
      ctx.order(code, shares);
      openCount++;
    }
  }
}

/** sizing stage (declarative, no timing): held set → target weights the engine reconciles to. */
function applySizing(method: SizingMethod, held: string[]): Record<string, number> {
  const targets: Record<string, number> = {};
  if (held.length === 0) return targets;
  if (method.kind === 'equal') {
    const w = 1 / held.length;
    for (const c of held) targets[c] = w;
  } else if (method.kind === 'equityPct') {
    for (const c of held) targets[c] = method.pct;
  } else {
    const k = Math.max(1, Math.floor(method.k));
    const w = 1 / k;
    for (const c of held.slice(0, k)) targets[c] = w;
  }
  return targets;
}

/** Compile a pipeline IR: fold universe→filter*→select?→timing?→sizing each schedule boundary into a
 * target book, then setHoldings (the engine reconciles). One clock = `ir.schedule`. */
function interpretPipeline(ir: PipelineIR): Strategy {
  const find = <K extends Stage['kind']>(k: K): StageOf<K> | undefined =>
    ir.stages.find((s): s is StageOf<K> => s.kind === k);
  const universe = find('universe');
  const filterStages = ir.stages.filter((s): s is StageOf<'filter'> => s.kind === 'filter');
  const select = find('select');
  const timing = find('timing');
  const sizing = find('sizing');
  if (!universe) throw new Error('pipeline 缺少 universe 阶段');
  if (!sizing) throw new Error('pipeline 缺少 sizing 阶段');

  const needBars = timing ? maxWindow(timing.entry, timing.exit) + 2 : 0;
  const needValuation = filterStages.length > 0 || select != null; // these read bar() valuation
  let lastKey = '';

  return {
    name: 'ir:pipeline',
    factors: select?.factors,
    async onBar(ctx) {
      const key = periodKey(ctx.date, ir.schedule);
      if (key === lastKey) return; // not a schedule boundary
      lastKey = key;

      // universe → candidate codes (load the cross-section when a later stage needs valuation)
      let codes: string[];
      if (universe.source.type === 'all') {
        codes = await ctx.universe();
      } else {
        codes = universe.source.codes;
        if (needValuation) await ctx.universe();
      }

      for (const f of filterStages) codes = applyFilter(f.filters, codes, ctx);
      if (select) codes = applySelect(select, codes, ctx);

      if (timing) {
        // timing present → imperative buy-and-hold (order on entry, exit on exit)
        await applyTiming(timing, codes, sizing.method, needBars, ctx);
      } else {
        // no timing → hold the whole eligible set, reconciled to target weights each period
        ctx.setHoldings(applySizing(sizing.method, codes));
      }
    },
  };
}

/** Compile a strategy IR (a stage pipeline) into an engine Strategy. */
export function interpretStrategy(ir: StrategyIR): Strategy {
  return interpretPipeline(ir);
}

/** Run a full backtest from an IR config. This is what the API route and demo scripts call.
 * `onLog` (optional) receives progress lines from the engine — the worker forwards them to the job. */
export async function runBacktestConfig(
  config: BacktestConfig,
  onLog?: (line: string) => void,
): Promise<BacktestResult> {
  const strategy = interpretStrategy(config.strategy);
  return runStrategy({
    start: config.start,
    end: config.end,
    initialCash: config.initialCash,
    cost: config.cost,
    strategy,
    onLog,
  });
}
