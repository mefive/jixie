import type {
  PipelineIR,
  Schedule,
  SizingMethod,
  Stage,
  StrategyIR,
  UniverseFilter,
} from '@jixie/shared';
import type { BarContext, BarRow, Strategy } from '../../engine/types.js';
import { evalExpr, type ExprScope } from './expr.js';
import { evalCondition, evalIndExpr, indExprWindow, maxWindow, type IndScope } from './ind-expr.js';

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

/** timing stage: a per-instrument rule-based state machine. Each bar, for every candidate (eligible to
 * enter) or current holding (to manage/exit), the FIRST rule whose `when` holds fires its actions
 * (if/elif/else). Actions buy/sell or mutate the instrument's declared state; `stateStore` persists
 * that state across bars. Gate vs hard: a held name that fell out of the eligible set is kept (gate —
 * its exit rules still run) or force-exited (hard). */
async function applyTiming(
  timing: StageOf<'timing'>,
  eligible: string[],
  sizing: SizingMethod,
  needBars: number,
  ctx: BarContext,
  stateStore: Map<string, Map<string, number>>,
): Promise<void> {
  const eligibleSet = new Set(eligible);
  const heldNow = ctx.positions().map((p) => p.code);
  const codes = [...new Set([...eligible, ...heldNow])];
  await ctx.ensureBars(codes); // lazy-load the dynamic set's bars

  for (const code of codes) {
    const bars = ctx.bars(code, needBars);
    if (bars.length < 2) continue; // warming up
    let st = stateStore.get(code);
    if (!st) {
      st = new Map((timing.state ?? []).map((v) => [v.name, v.init]));
      stateStore.set(code, st);
    }
    const shares = ctx.shares(code);
    if (timing.membership === 'hard' && shares > 0 && !eligibleSet.has(code)) {
      ctx.exit(code); // hard: a holding no longer selected is dropped
      continue;
    }
    const scope: IndScope = { bars, shares, equity: ctx.value, state: (n) => st.get(n) ?? 0 };
    for (const rule of timing.rules) {
      if (!evalCondition(rule.when, scope)) continue;
      for (const a of rule.do) runTimingAction(a, code, sizing, scope, st, ctx, eligible.length);
      break; // first matching rule wins (if / elif / else)
    }
  }
}

/** Execute one timing action: order at next open (buy/order), exit, or mutate state immediately. */
function runTimingAction(
  a: StageOf<'timing'>['rules'][number]['do'][number],
  code: string,
  sizing: SizingMethod,
  scope: IndScope,
  st: Map<string, number>,
  ctx: BarContext,
  poolSize: number,
): void {
  switch (a.kind) {
    case 'exit':
      ctx.exit(code);
      break;
    case 'buy': {
      const px = scope.bars[scope.bars.length - 1].adjClose;
      const sh = entryShares(sizing, scope.equity ?? ctx.value, px, poolSize);
      if (sh > 0) ctx.order(code, sh);
      break;
    }
    case 'order': {
      const sh = evalIndExpr(a.shares, scope);
      if (Number.isFinite(sh) && sh !== 0) ctx.order(code, sh);
      break;
    }
    case 'set':
      st.set(a.var, evalIndExpr(a.value, scope));
      break;
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

  // bars to load for timing = widest indicator window across all rule conditions + action exprs.
  let needBars = 0;
  if (timing) {
    let w = 1;
    for (const r of timing.rules) {
      w = Math.max(w, maxWindow(r.when));
      for (const a of r.do) {
        if (a.kind === 'order') w = Math.max(w, indExprWindow(a.shares));
        else if (a.kind === 'set') w = Math.max(w, indExprWindow(a.value));
      }
    }
    needBars = w + 2;
  }
  const timingState = new Map<string, Map<string, number>>(); // per-instrument state, persists across bars
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
        // timing present → run the per-instrument rule state machine (imperative orders)
        await applyTiming(timing, codes, sizing.method, needBars, ctx, timingState);
      } else {
        // no timing → hold the whole eligible set, reconciled to target weights each period
        ctx.setHoldings(applySizing(sizing.method, codes));
      }
    },
  };
}

/** Compile a strategy IR (a stage pipeline) into an engine Strategy. (Legacy IR path — superseded by
 * code-first authoring; retained only for the interpret unit tests until the IR layer is removed.) */
export function interpretStrategy(ir: StrategyIR): Strategy {
  return interpretPipeline(ir);
}
