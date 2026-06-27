import type { TradeDate } from './types.js';

/**
 * Strategy IR (intermediate representation) — the structured, round-trippable strategy spec.
 *
 * Natural language, the visual flowchart, and generated code are all *projections* of this IR; the
 * IR is the single source of truth. The api interprets it directly on the backtest engine (no eval),
 * which keeps it safe to run untrusted/AI-authored strategies. Every node is a tagged object, so it
 * maps 1:1 to an editor node and is straightforward for an LLM to emit as validated structured output.
 *
 * v1 covers the cross-sectional archetype (rank a universe by a signal, hold a quantile) — the most
 * common "调仓" strategy. The per-instrument state-machine archetype (Turtle-style) is added next.
 */

export type Schedule = 'daily' | 'weekly' | 'monthly';

/** Expression over one stock's row, as a tagged AST (no string parsing, no eval). */
export type Expr =
  | { kind: 'const'; value: number }
  | { kind: 'field'; name: string } // a bar/valuation field: peTtm, pb, dvRatio, totalMv, turnoverRate, adjClose, …
  | { kind: 'factor'; name: string } // a precomputed factor column: mom, rev, vol
  | { kind: 'unary'; op: 'neg' | 'abs' | 'ln'; arg: Expr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr };

export type CmpOp = '>' | '>=' | '<' | '<=';

/** Universe filters — a curated, finite palette (not arbitrary code). */
export type UniverseFilter =
  | { kind: 'minListDays'; days: number } // exclude stocks listed < days ago (point-in-time)
  | { kind: 'dropIlliquidPct'; pct: number } // drop the bottom pct% by turnover
  | { kind: 'field'; field: string; op: CmpOp; value: number }; // keep stocks where field op value

// —— Timing: a per-instrument rule-based state machine ——
//
// A `timing` stage trades each candidate INDEPENDENTLY off its own bar window. It declares scalar
// per-instrument state variables and an ordered list of rules `{ when, do }`; each bar the first rule
// whose `when` holds fires its actions (if / elif / else). Actions buy/sell or mutate state, so the
// full Turtle (volatility-sized entry, pyramiding adds, trailing stop) is expressible — no hardcoded
// algorithm. Indicators (highest/lowest/sma/ema/atr) are computed on the fly from the instrument's bars.

export type IndicatorName = 'highest' | 'lowest' | 'sma' | 'ema' | 'atr';
export type PriceField = 'open' | 'high' | 'low' | 'close';

/** A numeric expression over ONE instrument's time series + its position/state. Leaves read the
 * instrument's price/indicators, a declared state variable, current shares, or equity — not a
 * cross-sectional row. `highest`/`lowest` scan the n bars *before* today (Donchian convention, so
 * `price > highest(high,20)` is a clean breakout); `sma`/`ema`/`atr` use the last n bars. */
export type IndExpr =
  | { kind: 'const'; value: number }
  | { kind: 'price' } // today's adjusted close
  | { kind: 'indicator'; name: IndicatorName; field?: PriceField; window: number }
  | { kind: 'state'; name: string } // a declared per-instrument state variable
  | { kind: 'shares' } // shares currently held of this instrument (0 = flat)
  | { kind: 'equity' } // current total portfolio equity
  | { kind: 'unary'; op: 'neg' | 'abs' | 'floor'; arg: IndExpr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | 'min' | 'max'; left: IndExpr; right: IndExpr };

export type CondOp = '>' | '>=' | '<' | '<=' | '==' | '!=';

/** Boolean condition over IndExprs — the `when` of a timing rule. */
export type Condition =
  | { kind: 'compare'; op: CondOp; left: IndExpr; right: IndExpr }
  | { kind: 'and'; args: Condition[] }
  | { kind: 'or'; args: Condition[] }
  | { kind: 'not'; arg: Condition };

/** Per-instrument scalar state variable, maintained by the engine (e.g. units held, trailing stop). */
export interface StateVar {
  name: string;
  init: number;
}

/** A timing action — fires at the next open (orders) or updates state immediately (set). */
export type TimingAction =
  | { kind: 'buy' } // open/add a position sized by the sizing stage
  | { kind: 'order'; shares: IndExpr } // buy (+) / sell (−) an explicit share count (e.g. equal-risk unit)
  | { kind: 'exit' } // sell the whole position
  | { kind: 'set'; var: string; value: IndExpr }; // mutate a state variable

/** One rule of the state machine: when `when` holds, run `do` in order. */
export interface TimingRule {
  when: Condition;
  do: TimingAction[];
}

// —— Pipeline IR: a strategy as an ordered list of stage nodes (data, not fixed fields) ——
//
// A strategy runs at ONE frequency (`schedule`). Each period the stages fold left→right, threading a
// value whose type evolves: `universe` produces a code set; `filter`/`select`/`timing` narrow it;
// `sizing` turns the held set into a target book (weights), which the engine reconciles holdings to.
// The old archetypes are just "which stages are present": cross-section = universe+filter+select+sizing
// (no timing → hold all selected, rebalanced on schedule); per-instrument = universe(list)+timing+sizing
// (no select → static watch, event-driven); selection+timing = both. Adding a stage kind never touches
// the top-level shape — it's a new `Stage` variant + one interpreter branch.

export type UniverseSource =
  | { type: 'all' } // the whole tradable market
  | { type: 'list'; codes: string[] }; // a fixed set of instruments
// reserved: { type: 'index'; code: string } — point-in-time index membership (not yet interpreted)

export type SizingMethod =
  | { kind: 'equal' } // equal-weight every held name
  | { kind: 'equityPct'; pct: number } // each held name = pct of equity
  | { kind: 'kSlots'; k: number }; // at most k positions, each 1/k of equity

/** Ranking cut for the `select` stage: top/bottom `quantile` fraction, or a fixed `topN` count. */
export type PickRule = { by: 'quantile' | 'topN'; value: number };

export type Stage =
  | { kind: 'universe'; source: UniverseSource } // → CodeSet
  | { kind: 'filter'; filters: UniverseFilter[] } // CodeSet → CodeSet (hard predicates)
  | { kind: 'select'; score: Expr; factors?: string[]; side: 'high' | 'low'; pick: PickRule } // CodeSet → CodeSet (rank+cut)
  | { kind: 'timing'; state?: StateVar[]; rules: TimingRule[]; membership: 'gate' | 'hard' } // CodeSet → held CodeSet
  | { kind: 'sizing'; method: SizingMethod }; // CodeSet → TargetBook
// reserved: { kind: 'risk'; ... } — TargetBook → TargetBook

export interface PipelineIR {
  schedule: Schedule; // the single clock: the stages run on each schedule boundary
  stages: Stage[];
}

/** A strategy IR — a stage pipeline. */
export type StrategyIR = PipelineIR;

export interface CostConfig {
  commission?: number; // per-side rate (万2.5 = 0.00025)
  minCommission?: number; // floor per trade in yuan
  stampDuty?: number; // sell-side only (千0.5 = 0.0005)
  transferFee?: number; // both sides
}

/** A full, runnable backtest spec: range + capital + cost + the user-authored TS strategy code. */
export interface BacktestConfig {
  name: string;
  start: TradeDate;
  end: TradeDate;
  initialCash: number;
  cost?: CostConfig;
  code: string; // TypeScript strategy module: export default defineStrategy({ … })
}

/** Backtest result shape returned over the wire (mirrors the engine's BacktestResult). */
export interface BacktestSummary {
  name: string;
  start: TradeDate;
  end: TradeDate;
  days: number;
  initialCash: number;
  finalValue: number;
  totalReturn: number;
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  trades: number;
  nav: { date: string; value: number }[];
}
