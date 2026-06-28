/**
 * The strategy SDK surface, as an ambient .d.ts fed to Monaco (addExtraLib) so the editor gives real
 * autocomplete + type-checking against `ctx` / `defineStrategy`. Authoring is import-free — these are
 * global declarations. Mirrors apps/api/src/strategy/code/sdk.ts (the runtime truth); keep in sync when
 * the SDK gains methods. Stored as a string (not a real .d.ts) so it doesn't pollute the app's own types.
 */
export const SDK_DTS = `
/** One stock's adjusted (hfq) OHLC on one day — the unit per-instrument math reads via ctx.bars(). */
interface OhlcBar {
  date: string;
  adjOpen: number; adjHigh: number; adjLow: number; adjClose: number;
}

/** One stock's full market row today: raw + adjusted OHLC and the point-in-time valuation snapshot. */
interface BarRow {
  code: string;
  open: number | null; high: number | null; low: number | null; close: number | null;
  adjOpen: number | null; adjHigh: number | null; adjLow: number | null; adjClose: number | null;
  pe: number | null; peTtm: number | null; pb: number | null; ps: number | null; psTtm: number | null;
  dvRatio: number | null; dvTtm: number | null;
  totalMv: number | null; circMv: number | null; turnoverRate: number | null;
  roe: number | null; roeWaa: number | null; // 净资产收益率 % (point-in-time)
}

type Schedule = 'daily' | 'weekly' | 'monthly';

/** A chainable view over today's codes — filter, rank, take a slice. */
interface Selection {
  /** Keep codes whose today-row passes the predicate. */
  where(pred: (bar: BarRow, code: string) => boolean): Selection;
  /** Keep codes listed at least \`days\` calendar days. */
  minListDays(days: number): Selection;
  /** Drop the bottom \`frac\` by \`key\` (e.g. liquidity: dropBottom(0.25, b => b.turnoverRate ?? 0)). */
  dropBottom(frac: number, key: (bar: BarRow, code: string) => number): Selection;
  /** Rank by a score (null-scoring codes dropped). dir 'desc' = highest first (default). */
  rankBy(score: (bar: BarRow, code: string) => number | null, dir?: 'desc' | 'asc'): Selection;
  /** Leading slice: a fraction when n < 1 (0.1 = top decile, min 1), else a count. */
  top(n: number): string[];
  /** The current codes. */
  codes(): string[];
  readonly length: number;
}

/** What a strategy sees and acts through, each bar. */
interface StrategyCtx {
  readonly date: string;
  readonly cash: number;
  readonly value: number;
  positions(): { code: string; shares: number; avgCost: number; marketValue: number }[];

  /** Today's tradable cross-section as a chainable selection (loads the panel; bar() valid after).
   * Pass an index code (e.g. '000300.SH' 沪深300) to restrict to its point-in-time constituents. */
  select(indexCode?: string): Promise<Selection>;
  /** Period key for today on a schedule — compare to a \`let last\` to fire once per period. */
  period(schedule: Schedule): string;
  /** Equal-weight the codes (a target-book rebalance at next open). */
  equalWeight(codes: string[]): void;
  /** Point-in-time constituents of an index (e.g. '000300.SH' 沪深300) as of today. */
  indexMembers(indexCode: string): Promise<string[]>;

  // 内置技术指标(需该票 K 线已加载:watch 或 ensureBars;数据不足返 null)
  /** n 日简单均线。 */
  sma(code: string, n: number): number | null;
  /** n 日指数均线。 */
  ema(code: string, n: number): number | null;
  /** n 日 ATR(平均真实波幅)。 */
  atr(code: string, n: number): number | null;
  /** 最近 n 根某字段的最高(唐奇安上轨)。 */
  highest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null;
  /** 最近 n 根某字段的最低(唐奇安下轨)。 */
  lowest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null;

  /** Today's tradable codes (loads the panel; makes bar() valid). */
  universe(): Promise<string[]>;
  /** Today's full row for a code (valid after select()/universe()), else null. */
  bar(code: string): BarRow | null;
  /** Last n adjusted OHLC bars up to today for watched/held codes. */
  bars(code: string, n: number): OhlcBar[];
  /** Lazily load bar series for codes so bars()/history() work on them this bar. */
  ensureBars(codes: string[]): Promise<void>;
  /** Calendar days since listing as of today; null if unknown. */
  listDays(code: string): number | null;
  /** Today's adjusted close (carried forward if suspended). */
  price(code: string): number | null;
  /** Last n adjusted prices up to today for held/loaded codes. */
  history(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number[];
  /** Precomputed factor column (only declared factors), as-of today. */
  factor(name: string, code: string): number | null;

  /** Current shares held of a code (0 if none). */
  shares(code: string): number;
  /** Declarative target weight for a code (rebalance at next open). */
  orderTargetPercent(code: string, weight: number): void;
  /** Declarative target book (code → weight). */
  setHoldings(weights: Record<string, number>): void;
  /** Imperative share order: +buy / -sell, filled at next open. */
  order(code: string, shares: number): void;
  /** Sell the entire current position. */
  exit(code: string): void;
}

interface CodeStrategy {
  name?: string;
  /** Precomputed factor columns to preload (price-window signals like mom/rev/vol). */
  factors?: string[];
  /** Instruments to preload bar series for up front (per-instrument systems). */
  watch?: string[];
  onBar(ctx: StrategyCtx): void | Promise<void>;
}

/** Define a strategy. \`export default defineStrategy({ onBar(ctx) { … } })\`. */
declare function defineStrategy(s: CodeStrategy): void;
`;
