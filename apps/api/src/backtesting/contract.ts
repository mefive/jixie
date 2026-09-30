import type { Locale } from '@jixie/shared';
import type { EngineDataPort } from './data/data-port.js';
import type { BarRow, FutureBar, IndexHandle, OhlcBar, ResamplePeriod } from './data/market.js';
import type { FactorExecutionPort } from './factors/execution-port.js';
import type { CostModel } from './cost.js';
import type { FuturePositionView } from './futures-portfolio.js';
import type { ConditionalOrderKind } from './order-book.js';

/** Host capabilities for one simulation date. Adapted by Strategy runtime before user access. */
export interface EngineContext {
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

  // Point-in-time market and factor reads.
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
  /** Internal primitive behind the SDK's weekly()/monthly() handles. Only periods known to have
   * fully closed by today are returned, so the current partial week/month never leaks. */
  resampledBars(code: string, period: ResamplePeriod, n: number): OhlcBar[];
  /** Lazily load the bar series for `codes` so bars()/history() work on them this bar. Needed when the
   * set is dynamic (a pipeline's selected names aren't known up front like a static `watch`). */
  ensureBars(codes: string[]): Promise<void>;
  /** Calendar days since listing as of today (point-in-time stock age); null if unknown. */
  listDays(code: string): number | null;
  /** Point-in-time SW level-1 industry label for `code` as of today; null if unknown. For
   * sector-neutral / rotation / single-industry logic without classification lookahead. */
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
  /** Market-index handle (e.g. '000300.SH' CSI 300) — point-in-time read-only: close/PE/PB are as-of
   * today, `sma(n)` uses index levels, and `percentile('pe', 2520)` ranks today's PE in roughly ten
   * trading years of history. The index isn't tradable; unsynced fields return null. */
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
  /** Queue whole real-share lots (100 shares per lot) for the next open. */
  orderLots(code: string, lots: number): void;
  exit(code: string): void; // sell the entire current position

  // Persistent conditional orders. They are declared after today's close and become eligible on the
  // next trading day; re-declaring the same kind/code updates it without resetting trailing history.
  stopLoss(code: string, price: number): void;
  trailingStop(code: string, pct: number): void;
  limitBuy(code: string, price: number, shares: number): void;
  takeProfit(code: string, pct: number): void;
  cancelConditional(code: string, kind?: ConditionalOrderKind): void;

  /** Convenience: current shares held of `code` (0 if none). */
  shares(code: string): number;
  /** Queue a signed futures contract delta for the next open. Requires declared futures. */
  orderFuture(code: string, contracts: number): void;
  /** Set the signed contract target for the next open. */
  setFutureTargetContracts(code: string, contracts: number): void;
  /** Set a signed futures notional target for the next open (negative means short). */
  setFutureTargetNotional(code: string, notional: number): void;
  /** Hedge the actually filled stock sleeve at the next open. beta=1 requests a full short hedge. */
  hedgeFuture(code: string, beta?: number): void;
  exitFuture(code: string): void;
}

export interface EngineAccounts {
  stock: { cashWeight: number };
  futures: { cashWeight: number };
}

/** A prepared decision callback. Contains no source, language runtime, user or saved-record identity. */
export interface EngineStrategy {
  name: string;
  /** User-declared finite numeric parameters. Scan overrides replace these values before a run. */
  params?: Record<string, number | string>;
  /** Declared built-in data columns and computed factor keys used by the strategy. */
  factors?: string[];
  /** Instruments a per-instrument strategy trades — the engine preloads their bar series up front so
   * bars()/price() work every day without touching the cross-section. */
  watch?: string[];
  /** @deprecated Accepted for source compatibility; ignored. Use accounts to allocate capital. */
  futures?: string[];
  /** Initial capital weights for isolated stock/futures accounts; defaults to stock 1, futures 0.
   * Cash is not transferred automatically between accounts. */
  accounts?: EngineAccounts;
  onBar(ctx: EngineContext): void | Promise<void>;
}

export interface BacktestingConfig {
  strictFutures?: boolean;
  start: string; // YYYYMMDD
  end: string;
  initialCash: number;
  strategy: EngineStrategy;
  cost?: Partial<CostModel>;
  /** Optional progress sink — the engine emits human-readable lines (start / rebalance / yearly
   * heartbeat / done) as the run advances. The worker forwards these to the job for log polling;
   * scripts and tests omit it (no-op). */
  onLog?: (line: string) => void;
  /** Locale for the engine's user-facing progress logs / warnings; defaults to DEFAULT_LOCALE at the
   * use site (scripts and tests omit it). */
  locale?: Locale;
  /** Required storage doorway: the host supplies Prisma and tests supply a fixture. */
  dataPort: EngineDataPort;
  /** Provides factor definitions and computation. The caller owns and closes sandbox runtimes. */
  factorExecution?: FactorExecutionPort;
}
