/**
 * The engine's ONLY doorway to storage (sandbox Phase B1, docs/design/python-and-sandbox.md).
 * Deliberately dumb: every method fetches plain JSON-able rows — no domain logic, no PIT gating,
 * no panel building (all of that stays in EngineData, i.e. inside the future isolate wall).
 * Two implementations by lane:
 *   - prismaDataPort (below): the direct lane — tests, research scripts, engine debugging;
 *   - the Phase B2 isolate bridge: same interface, rows serialized across the wall.
 * Keeping methods coarse (one call = one whole batch of rows) is what keeps wall-crossings rare.
 */

export interface StockBasicRow {
  tsCode: string;
  listDate: string;
  industry: string | null;
}

export interface TopListRow {
  tsCode: string;
  tradeDate: string;
  netAmount: number;
}

export interface IndexDailyRow {
  tsCode: string;
  tradeDate: string;
  close: number;
}

export interface MoneyflowRow {
  tsCode: string;
  tradeDate: string;
  netMain: number;
  netTotal: number | null;
}

export interface FinaIndicatorRow {
  tsCode: string;
  annDate: string;
  roe: number | null;
  roeWaa: number | null;
}

export interface IndexWeightRow {
  conCode: string;
  tradeDate: string;
}

/** One trading day's raw panel rows (price + adjustment + valuation), optionally code-restricted. */
export interface CrossSectionRows {
  price: {
    tsCode: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    vol: number | null;
    amount: number | null;
  }[];
  adj: { tsCode: string; adjFactor: number }[];
  basic: {
    tsCode: string;
    pe: number | null;
    peTtm: number | null;
    pb: number | null;
    ps: number | null;
    psTtm: number | null;
    dvRatio: number | null;
    dvTtm: number | null;
    totalMv: number | null;
    circMv: number | null;
    turnoverRate: number | null;
  }[];
}

/** Raw per-stock series rows over the run range (price + adjustment + limit prices). */
export interface BarsRows {
  px: {
    tsCode: string;
    tradeDate: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    vol: number | null;
    amount: number | null;
  }[];
  adj: { tsCode: string; tradeDate: string; adjFactor: number }[];
  limits: { tsCode: string; tradeDate: string; upLimit: number; downLimit: number }[];
}

export interface EngineDataPort {
  /** Open trading days (SSE) within [start, end], ascending. */
  openDates(start: string, end: string): Promise<string[]>;
  /** The full stock list (list dates + current industry labels). */
  stockBasics(): Promise<StockBasicRow[]>;
  /** Dragon-Tiger List rows within [start, end] (sparse event data). */
  topListRange(start: string, end: string): Promise<TopListRow[]>;
  /** All synced index daily closes (tiny), ascending by (code, date). */
  indexDailyAll(): Promise<IndexDailyRow[]>;
  /** Moneyflow rows within [start, end] (only fetched when a strategy declares mf factors). */
  moneyflowRange(start: string, end: string): Promise<MoneyflowRow[]>;
  /** One day's cross-section panel rows; `codes` restricts the read (universe gate pushdown). */
  crossSectionRows(date: string, codes?: string[]): Promise<CrossSectionRows>;
  /** All financial-indicator reports that have a public annDate, ascending by (code, annDate). */
  finaIndicators(): Promise<FinaIndicatorRow[]>;
  /** All constituent snapshots of one index, ascending by date. */
  indexWeights(indexCode: string): Promise<IndexWeightRow[]>;
  /** Per-stock series rows for `codes` within [start, end] (implementation may chunk internally). */
  barsRows(codes: string[], start: string, end: string): Promise<BarsRows>;
}
