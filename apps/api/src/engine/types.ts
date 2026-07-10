// Event-driven strategy backtest — core types.
// The engine simulates a real trading process: a per-day loop calls strategy.onBar(ctx);
// the strategy reads data + places orders via ctx; the engine executes fills (next-day open),
// maintains cash/positions (T+1), applies costs, and records a daily equity curve.
//
// Design principle (three layers): the engine knows only raw market data. It exposes general
// market primitives (bar / history / universe / orders) and has NO built-in notion of "factor".
// Factors are a strategy-side concern: valuation signals read bar() (daily_basic) directly; price-window
// signals (mom/rev/vol) compute on the fly from the bar series; moneyflow opts into a preloaded column.

import type { Locale } from '@jixie/shared';
import type { EngineDataPort } from './data-port.js';
import type { CustomFactorModule } from './custom-factor.js';

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
  amount: number; // realShares × realPrice = shares × price (trade value, real money)
  fee: number; // commission + stamp + transfer
  realShares: number; // real shares filled — buys are whole lots (100 shares each)
  realPrice: number; // unadjusted (raw) fill price — what you'd actually have paid
  assetType?: 'stock' | 'future';
  actualCode?: string; // mapped delivery contract for a logical continuous futures order
  contracts?: number; // futures quantity in contracts
  multiplier?: number; // CNY per index point
}

/** Trading friction model: explicit fees (rates are fractions of trade value) + implicit slippage. Fees
 * hit `fee` on the trade; slippage instead worsens the fill PRICE (buys above / sells below the open), so
 * it shows up as a worse realized price, not a fee line. */
export interface CostModel {
  commission: number; // per-side rate, e.g. 0.00025 (0.025%)
  minCommission: number; // floor per trade in yuan, e.g. 5
  stampDuty: number; // sell-side only, e.g. 0.0005 (0.05%)
  transferFee: number; // both sides, e.g. 0.00001
  // —— Slippage (implicit cost, applied to the fill price) ——
  slippageBps: number; // base half-spread, both sides, in bps — the cost even for a liquid large-cap
  impactCoef: number; // linear price impact per (order notional / day turnover): a bigger order in a thinner
  //                     (small-cap) name pays more — this is what makes small/mid-cap / high-turnover realistically costlier
  futureCommissionRate: number; // per-side fraction of futures notional
  futureCloseTodayRate: number; // reserved for intraday close support
  futureSlippageTicks: number; // adverse ticks per futures fill
  futureMarginRate: number; // fallback when a historical settlement row has no margin rate
}

export interface FutureBar {
  code: string; // logical code requested by the strategy
  actualCode: string; // actual delivery contract as-of the bar date
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  settle: number | null;
  volume: number | null;
  amount: number | null;
  openInterest: number | null;
  multiplier: number;
}

export interface FuturePositionView {
  code: string;
  actualCode: string;
  contracts: number; // signed: positive long, negative short
  margin: number;
}

/** One stock's adjusted (hfq) OHLC on one day — the unit a per-instrument strategy reads via bars().
 * vol/amount are raw (not adjusted): the day's volume (lots) and turnover (thousand yuan). */
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
  vol: number | null; // volume (lots)
  amount: number | null; // turnover (thousand yuan) — the liquidity / slippage gate
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
  roe: number | null; // return on equity %, point-in-time (latest report public as-of today)
  roeWaa: number | null; // weighted average return on equity %
}

/** What the strategy sees and acts through, each bar. */
/** Read-only market-index handle (ctx.index) — point-in-time as-of today; an index isn't tradable. */
export interface IndexHandle {
  readonly close: number | null; // today's index level (as-of ≤ today); null if not synced
  sma(n: number): number | null; // n-day moving average (index close series); null if insufficient data
}

export interface BarContext {
  readonly date: string;
  readonly cash: number;
  readonly value: number; // total equity = cash + positions market value
  readonly availableCash: number; // cash less futures margin; equals cash in stock-only mode
  readonly stockValue: number; // stock sleeve equity (cash + marked stock positions)
  readonly futureValue: number; // futures sleeve equity after the latest daily settlement
  readonly stockAvailableCash: number;
  readonly futureAvailableCash: number; // futures equity less reserved margin
  readonly futureMargin: number;

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
  /** Today's Dragon-Tiger List net buy amount (yuan); null on days not on the list (not carried forward) — attention / hot-money extreme signal. */
  lhbNet(code: string): number | null;
  /** Today's adjusted close (carried forward if suspended) for held/already-loaded codes. */
  price(code: string): number | null;
  /** Last n adjusted prices up to today for held/already-loaded codes (price-window math on holdings). */
  history(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number[];
  /** Preloaded moneyflow column lookup (only the keys the strategy declared in `factors`, e.g.
   * 'mf_net_main'). The engine treats it as opaque preloaded data; as-of `date`, null if absent. */
  factor(name: string, code: string): number | null;
  /** Point-in-time constituents of an index (e.g. '000300.SH' CSI 300) as of today — the codes from the
   * latest monthly snapshot ≤ today. Async (lazily loads the index's snapshots on first use). */
  indexMembers(indexCode: string): Promise<string[]>;
  /** Market-index handle (e.g. '000300.SH' CSI 300) — point-in-time read-only: `close` today's level,
   * `sma(n)` the n-day moving average (index's own close series). For market-timing filters (e.g. "go long
   * only when CSI 300 is above its 200-day moving average"). The index isn't tradable; data comes from
   * IndexDaily (must be synced), close/sma return null if not synced. */
  index(indexCode: string): IndexHandle;
  /** Stock-index futures bar for an actual or logical continuous code as-of today. */
  future(code: string): FutureBar | null;
  /** Last n values from the point-in-time mapped futures series, oldest to newest. */
  futureHistory(
    code: string,
    field: 'open' | 'high' | 'low' | 'close' | 'settle',
    n: number,
  ): number[];
  futurePosition(code: string): FuturePositionView | null;

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
  /** Queue a signed futures contract delta for the next open. Futures strategies are futures-only. */
  orderFuture(code: string, contracts: number): void;
  /** Set the signed contract target for the next open. */
  setFutureTargetContracts(code: string, contracts: number): void;
  /** Set a signed futures notional target for the next open (negative means short). */
  setFutureTargetNotional(code: string, notional: number): void;
  /** Hedge the actually filled stock sleeve at the next open. beta=1 requests a full short hedge. */
  hedgeFuture(code: string, beta?: number): void;
  exitFuture(code: string): void;
}

export interface StrategyAccounts {
  stock: { cashWeight: number };
  futures: { cashWeight: number };
}

export interface Strategy {
  name: string;
  /** Moneyflow columns to preload (e.g. ['mf_net_main']) for ctx.factor(). Omit unless the strategy
   * reads moneyflow; price/valuation signals need no preload (computed on the fly / read from bar()). */
  factors?: string[];
  /** Instruments a per-instrument strategy trades — the engine preloads their bar series up front so
   * bars()/price() work every day without touching the cross-section. */
  watch?: string[];
  /** Logical continuous or actual futures codes to preload. */
  futures?: string[];
  /** Explicitly split initial capital into isolated stock/futures sleeves. Omit to preserve legacy
   * stock-only or futures-only behavior. Cash is not transferred automatically between sleeves. */
  accounts?: StrategyAccounts;
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
  /** Locale for the engine's user-facing progress logs / warnings; defaults to DEFAULT_LOCALE at the
   * use site (scripts and tests omit it). */
  locale?: Locale;
  /** Storage doorway (Phase B1). Defaults to prismaDataPort (the direct lane); tests inject fixture
   * ports; the Phase B2 walled lane injects the isolate bridge. */
  dataPort?: EngineDataPort;
  /** Custom (defineFactor) factors the strategy references via `factors: ['custom:<key>']` —
   * host-prepared (ownership-checked, TS→CJS); evaluated in the engine's own world (see
   * custom-factor.ts). A declared custom key with no module here fails the run explicitly. */
  customFactors?: CustomFactorModule[];
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
  sleeveNav?: SleeveNavPoint[];
  benchReturn: number; // CSI 300 total return over the same period
  excessReturn: number; // totalReturn − benchReturn
  informationRatio: number; // annualized information ratio
  calmar: number; // annReturn / |maxDrawdown|
  winRate: number; // share of profitable closed trades
  profitFactor: number; // Σ profit / Σ loss
  turnover: number; // annualized turnover
  monthly: { month: string; ret: number }[]; // 'YYYYMM' → monthly return
}

export interface SleeveNavPoint {
  date: string;
  stockValue: number;
  futureValue: number;
  futureMargin: number;
  stockGrossExposure: number;
  futureNotional: number;
  netExposure: number;
}

export const DEFAULT_COST: CostModel = {
  commission: 0.00025,
  minCommission: 5,
  stampDuty: 0.0005,
  transferFee: 0.00001,
  slippageBps: 2, // ~0.02% base half-spread
  impactCoef: 0.1, // order = 1% of the day's turnover → +0.1% slip; = 5% → +0.5%
  futureCommissionRate: 0.000023,
  futureCloseTodayRate: 0.00023,
  futureSlippageTicks: 1,
  futureMarginRate: 0.12,
};
