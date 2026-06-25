// Event-driven strategy backtest — core types.
// The engine simulates a real trading process: a per-day loop calls strategy.onBar(ctx);
// the strategy reads data + places orders via ctx; the engine executes fills (next-day open),
// maintains cash/positions (T+1), applies costs, and records a daily equity curve.
//
// Design principle (three layers): the engine knows only raw market data. It exposes general
// market primitives (bar / history / universe / orders) and has NO built-in notion of "factor".
// Factors are a strategy-side concern: value/valuation signals read bar() (daily_basic) directly;
// price-window signals (mom/rev/vol) opt into precomputed columns the engine preloads on request.

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

/** One stock's adjusted (hfq) OHLC on one day — the unit a per-instrument strategy reads via bars(). */
export interface OhlcBar {
  date: string;
  adjOpen: number;
  adjHigh: number;
  adjLow: number;
  adjClose: number;
}

/**
 * One stock's full market row on a given day: backward-adjusted (hfq) OHLC for return math, the raw
 * unadjusted OHLC for reference, and the raw daily_basic valuation (point-in-time). This is the unit
 * a cross-sectional strategy ranks on. A field is null when the source didn't report it that day.
 */
export interface BarRow {
  code: string;
  open: number | null; // unadjusted
  high: number | null;
  low: number | null;
  close: number | null;
  adjOpen: number | null; // backward-adjusted (hfq)
  adjHigh: number | null;
  adjLow: number | null;
  adjClose: number | null;
  pe: number | null;
  peTtm: number | null;
  pb: number | null;
  ps: number | null;
  psTtm: number | null;
  dvRatio: number | null; // dividend yield %
  dvTtm: number | null;
  totalMv: number | null; // total market cap (10k yuan)
  circMv: number | null; // circulating market cap (10k yuan)
  turnoverRate: number | null; // turnover %
}

/** What the strategy sees and acts through, each bar. */
export interface BarContext {
  readonly date: string;
  readonly cash: number;
  readonly value: number; // total equity = cash + positions market value

  positions(): { code: string; shares: number; avgCost: number; marketValue: number }[];

  // —— Market primitives (general; the engine has no concept of "factor") ——
  /** Today's tradable cross-section (codes with a daily bar + adj factor + valuation). Async because
   * it lazily loads the whole-market panel for `date` on first use (only days the strategy inspects
   * are ever loaded). Calling this also makes bar() valid for today. */
  universe(): Promise<string[]>;
  /** Today's full row for `code` — valid after universe() loaded this day's cross-section; else null. */
  bar(code: string): BarRow | null;
  /** Last n adjusted OHLC bars up to today for watched/held codes (per-instrument window math:
   * Donchian channels, ATR, etc.). Empty if the code's series isn't loaded. */
  bars(code: string, n: number): OhlcBar[];
  /** Calendar days since listing as of today (point-in-time stock age); null if unknown. */
  listDays(code: string): number | null;
  /** Today's adjusted close (carried forward if suspended) for held/already-loaded codes. */
  price(code: string): number | null;
  /** Last n adjusted prices up to today for held/already-loaded codes (price-window math on holdings). */
  history(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number[];
  /** Optional precomputed column lookup (only the factors the strategy declared in `factors`). The
   * engine treats these as opaque preloaded data; it does not know what they mean. As-of `date`. */
  factor(name: string, code: string): number | null;

  // —— Orders ——
  // Declarative (target-book): fits cross-sectional rebalancing, maps cleanly to a web form later.
  orderTargetPercent(code: string, weight: number): void;
  setHoldings(weights: Record<string, number> | Map<string, number>): void;
  // Imperative (share deltas): fits per-instrument systems (Turtle: add a unit, hit a stop). Orders
  // queue and fill at the next open. A bar uses either the declarative or the imperative API.
  order(code: string, shares: number): void; // +buy / -sell
  exit(code: string): void; // sell the entire current position

  /** Convenience: current shares held of `code` (0 if none). */
  shares(code: string): number;
}

export interface Strategy {
  name: string;
  /** Precomputed factor columns to preload from FactorValue (price-window signals). Omit for
   * pure-valuation strategies, which read bar() directly and touch no precomputed data. */
  factors?: string[];
  /** Instruments a per-instrument strategy trades — the engine preloads their bar series up front so
   * bars()/price() work every day without touching the cross-section. */
  watch?: string[];
  onBar(ctx: BarContext): void | Promise<void>;
}

export interface EngineConfig {
  start: string; // YYYYMMDD
  end: string;
  initialCash: number;
  strategy: Strategy;
  cost?: Partial<CostModel>;
  /** Optional progress sink — the engine emits human-readable lines (start / rebalance / yearly
   * heartbeat / done) as the run advances. The worker forwards these to the job for log polling;
   * scripts and tests omit it (no-op). */
  onLog?: (line: string) => void;
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
