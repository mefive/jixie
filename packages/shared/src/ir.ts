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

export interface CrossSectionIR {
  type: 'cross_section';
  schedule: Schedule;
  universe: { filters: UniverseFilter[] };
  score: Expr; // computed per stock, ranked across the universe
  factors?: string[]; // precomputed columns to preload (when score references { kind: 'factor' })
  pick: { side: 'high' | 'low'; quantile: number }; // e.g. 0.1 = top/bottom decile
  weight: 'equal'; // v1: equal-weight the picks
}

/** A strategy IR. The union grows as new archetypes are added (per_instrument next). */
export type StrategyIR = CrossSectionIR;

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
