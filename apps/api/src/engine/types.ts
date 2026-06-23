// Event-driven strategy backtest — core types.
// The engine simulates a real trading process: a per-day loop calls strategy.onBar(ctx);
// the strategy reads data + places orders via ctx; the engine executes fills (next-day open),
// maintains cash/positions (T+1), applies costs, and records a daily equity curve.

/** One stock's bar (prices are backward-adjusted / hfq, so returns are total-return). */
export interface Bar {
  date: string;
  adjOpen: number;
  adjClose: number;
}

/** A held position. frozenUntil = first date the shares may be sold (T+1). */
export interface Position {
  shares: number;
  avgCost: number;
  frozenUntil: string;
}

/** Trading cost model (rates are fractions of trade value). */
export interface CostModel {
  commission: number; // per-side rate, e.g. 0.00025 (万2.5)
  minCommission: number; // floor per trade in yuan, e.g. 5
  stampDuty: number; // sell-side only, e.g. 0.0005 (千0.5)
  transferFee: number; // both sides, e.g. 0.00001
}

/** What the strategy sees and acts through, each bar. */
export interface BarContext {
  readonly date: string;
  readonly cash: number;
  readonly value: number; // total equity = cash + positions market value

  positions(): { code: string; shares: number; marketValue: number }[];
  price(code: string): number | null; // today's adjusted close (carry-forward if suspended)
  history(code: string, n: number): number[]; // last n adjusted closes up to today (held/traded stocks)
  universe(): string[]; // tradable cross-section today (served on rebalance days)
  factor(name: string, code: string): number | null; // precomputed factor value at today

  // Orders. MVP is target-book based (declarative rebalance), which fits factor strategies and
  // maps cleanly to a config-driven web UI later.
  orderTargetPercent(code: string, weight: number): void;
  setHoldings(weights: Record<string, number> | Map<string, number>): void;
}

export interface Strategy {
  name: string;
  onBar(ctx: BarContext): void;
}

export interface EngineConfig {
  start: string; // YYYYMMDD
  end: string;
  initialCash: number;
  strategy: Strategy;
  cost?: Partial<CostModel>;
}

export interface BacktestResult {
  name: string;
  start: string;
  end: string;
  days: number;
  initialCash: number;
  finalValue: number;
  totalReturn: number;
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  trades: number;
  nav: { date: string; value: number }[]; // daily equity curve
}

export const DEFAULT_COST: CostModel = {
  commission: 0.00025,
  minCommission: 5,
  stampDuty: 0.0005,
  transferFee: 0.00001,
};
