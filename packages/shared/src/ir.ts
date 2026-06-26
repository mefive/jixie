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

// —— Time-series indicators (used by the `timing` stage) ——
//
// A `timing` stage trades each candidate INDEPENDENTLY off its own bar window: indicators
// (highest/lowest/sma/ema/atr) computed on the fly drive a flat↔holding decision. The position state
// itself is the edge-trigger (entry only fires on a flat name, exit on a held one).

export type IndicatorName = 'highest' | 'lowest' | 'sma' | 'ema' | 'atr';
export type PriceField = 'open' | 'high' | 'low' | 'close';

/** A numeric expression over ONE instrument's time series (its own bar window). Distinct from the
 * cross-section Expr: leaves read the instrument's price/indicators, not a cross-sectional row.
 * `highest`/`lowest` are over the n bars *before* today (Donchian convention, so `price > highest(high,20)`
 * is a clean breakout); `sma`/`ema`/`atr` are over the last n bars. */
export type IndExpr =
  | { kind: 'const'; value: number }
  | { kind: 'price' } // today's adjusted close
  | { kind: 'indicator'; name: IndicatorName; field?: PriceField; window: number }
  | { kind: 'unary'; op: 'neg' | 'abs'; arg: IndExpr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: IndExpr; right: IndExpr };

/** Boolean condition over IndExprs — the `when` of an entry/exit rule. */
export type Condition =
  | { kind: 'compare'; op: CmpOp; left: IndExpr; right: IndExpr }
  | { kind: 'and'; args: Condition[] }
  | { kind: 'or'; args: Condition[] }
  | { kind: 'not'; arg: Condition };

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
  | { kind: 'timing'; entry: Condition; exit: Condition; membership: 'gate' | 'hard' } // CodeSet → held CodeSet
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

/** A full, runnable backtest spec: range + capital + cost + the strategy IR. */
export interface BacktestConfig {
  name: string;
  start: TradeDate;
  end: TradeDate;
  initialCash: number;
  cost?: CostConfig;
  strategy: StrategyIR;
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
