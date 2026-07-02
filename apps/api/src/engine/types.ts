// Event-driven strategy backtest — core types.
// The engine simulates a real trading process: a per-day loop calls strategy.onBar(ctx);
// the strategy reads data + places orders via ctx; the engine executes fills (next-day open),
// maintains cash/positions (T+1), applies costs, and records a daily equity curve.
//
// Design principle (three layers): the engine knows only raw market data. It exposes general
// market primitives (bar / history / universe / orders) and has NO built-in notion of "factor".
// Factors are a strategy-side concern: valuation signals read bar() (daily_basic) directly; price-window
// signals (mom/rev/vol) compute on the fly from the bar series; moneyflow opts into a preloaded column.

/** A held position. frozenUntil = first date the shares may be sold (T+1). */
export interface Position {
  shares: number;
  avgCost: number;
  frozenUntil: string;
}

/** One executed fill — the trade log unit (returned with the result; plotted + listed in the UI). */
export interface TradeRecord {
  date: string; // fill date (next open after the order)
  code: string;
  side: 'buy' | 'sell';
  shares: number; // hfq shares (engine-internal accounting)
  price: number; // hfq (adjusted) fill price (engine-internal)
  amount: number; // realShares × realPrice = shares × price (成交额, real money)
  fee: number; // commission + stamp + transfer
  realShares: number; // real shares filled — buys are whole 手 (100-share lots)
  realPrice: number; // unadjusted (raw) fill price — what you'd actually have paid
}

/** Trading cost model (rates are fractions of trade value). */
export interface CostModel {
  commission: number; // per-side rate, e.g. 0.00025 (万2.5)
  minCommission: number; // floor per trade in yuan, e.g. 5
  stampDuty: number; // sell-side only, e.g. 0.0005 (千0.5)
  transferFee: number; // both sides, e.g. 0.00001
}

/** One stock's adjusted (hfq) OHLC on one day — the unit a per-instrument strategy reads via bars().
 * vol/amount are raw (not adjusted): the day's volume (手) and turnover (成交额, 千元). */
export interface OhlcBar {
  date: string;
  adjOpen: number;
  adjHigh: number;
  adjLow: number;
  adjClose: number;
  vol: number | null;
  amount: number | null;
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
  vol: number | null; // 成交量 (手)
  amount: number | null; // 成交额 (千元) — the liquidity / slippage gate
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
  roe: number | null; // 净资产收益率 %, point-in-time (latest report public as-of today)
  roeWaa: number | null; // 加权平均净资产收益率 %
}

/** What the strategy sees and acts through, each bar. */
export interface BarContext {
  readonly date: string;
  readonly cash: number;
  readonly value: number; // total equity = cash + positions market value

  positions(): { code: string; shares: number; avgCost: number; marketValue: number }[];

  // —— Market primitives (general; the engine has no concept of "factor") ——
  /** Load today's tradable cross-section (codes with a daily bar + adj factor + valuation) and return its
   * codes. Optionally restrict to an index's point-in-time constituents — the restriction is pushed into
   * the DB read (only those rows are loaded), the data gate behind the SDK's `universe(indexCode?)`. Async;
   * lazily loads the panel for `date` on first use (only days the strategy inspects are loaded). Calling
   * it also makes bar() valid for the loaded codes. */
  loadCrossSection(indexCode?: string): Promise<string[]>;
  /** Today's full row for `code` — valid after loadCrossSection() loaded this day's panel; else null. */
  bar(code: string): BarRow | null;
  /** Last n adjusted OHLC bars up to today for watched/held codes (per-instrument window math:
   * Donchian channels, ATR, etc.). Empty if the code's series isn't loaded. */
  bars(code: string, n: number): OhlcBar[];
  /** Lazily load the bar series for `codes` so bars()/history() work on them this bar. Needed when the
   * set is dynamic (a pipeline's selected names aren't known up front like a static `watch`). */
  ensureBars(codes: string[]): Promise<void>;
  /** Calendar days since listing as of today (point-in-time stock age); null if unknown. */
  listDays(code: string): number | null;
  /** Industry label for `code` (current classification, not point-in-time); null if unknown. For
   * sector-neutral / rotation / single-industry logic. */
  industry(code: string): string | null;
  /** 今日龙虎榜净买入额(元);未上榜当天返 null(不前向填充)—— 关注度/游资 极端信号。 */
  lhbNet(code: string): number | null;
  /** Today's adjusted close (carried forward if suspended) for held/already-loaded codes. */
  price(code: string): number | null;
  /** Last n adjusted prices up to today for held/already-loaded codes (price-window math on holdings). */
  history(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number[];
  /** Preloaded moneyflow column lookup (only the keys the strategy declared in `factors`, e.g.
   * 'mf_net_main'). The engine treats it as opaque preloaded data; as-of `date`, null if absent. */
  factor(name: string, code: string): number | null;
  /** Point-in-time constituents of an index (e.g. '000300.SH' 沪深300) as of today — the codes from the
   * latest monthly snapshot ≤ today. Async (lazily loads the index's snapshots on first use). */
  indexMembers(indexCode: string): Promise<string[]>;

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
  /** Moneyflow columns to preload (e.g. ['mf_net_main']) for ctx.factor(). Omit unless the strategy
   * reads moneyflow; price/valuation signals need no preload (computed on the fly / read from bar()). */
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
  trades: number; // count (= tradeLog.length)
  tradeLog: TradeRecord[]; // every fill, in order
  nav: { date: string; value: number }[]; // daily equity curve
  benchReturn: number; // 沪深300 同期总收益
  excessReturn: number; // totalReturn − benchReturn
  informationRatio: number; // 年化信息比率
  calmar: number; // annReturn / |maxDrawdown|
  winRate: number; // 盈利平仓占比
  profitFactor: number; // Σ盈利 / Σ亏损
  turnover: number; // 年化换手
  monthly: { month: string; ret: number }[]; // 'YYYYMM' → 月度收益
}

export const DEFAULT_COST: CostModel = {
  commission: 0.00025,
  minCommission: 5,
  stampDuty: 0.0005,
  transferFee: 0.00001,
};
