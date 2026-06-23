import { prisma } from '../lib/prisma.js';

interface StockBars {
  dates: string[]; // ascending trading days
  adjOpen: number[];
  adjClose: number[];
  idx: Map<string, number>; // date -> index (exact)
}

/**
 * Data access for the engine.
 *
 * The engine is just a daily ticker — it has no built-in notion of "rebalance day". The strategy
 * decides its own cadence in onBar. So cross-sectional reads (factor / universe) are "as-of":
 * they return the latest data known on or before the queried date (factor values live on month-ends;
 * on any later day you get the most recent month-end's values).
 *
 * Preloaded (whole range): timeline, next-trading-day map, factor values (+ as-of indexes).
 * Lazy + cached per stock: daily bars — only stocks actually traded/held get loaded (bounded memory).
 */
export class EngineData {
  timeline: string[] = [];
  private nextDayOf = new Map<string, string>();
  private factorByKey = new Map<string, Map<string, number>>(); // `${factor}|${date}` -> code -> value
  private factorDates = new Map<string, string[]>(); // factor -> ascending dates it has values on
  private csCodesByDate = new Map<string, Set<string>>(); // factor date -> codes with any factor value
  private csDates: string[] = []; // ascending distinct factor dates
  private barsCache = new Map<string, StockBars>();

  constructor(
    private start: string,
    private end: string,
  ) {}

  async load(): Promise<void> {
    const cal = await prisma.tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1, calDate: { gte: this.start, lte: this.end } },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    });
    this.timeline = cal.map((c) => c.calDate);
    for (let i = 0; i < this.timeline.length - 1; i++) {
      this.nextDayOf.set(this.timeline[i], this.timeline[i + 1]);
    }

    // Factor values across the range, grouped by factor|date.
    const fv = await prisma.factorValue.findMany({
      where: { tradeDate: { gte: this.start, lte: this.end } },
      select: { factor: true, tsCode: true, tradeDate: true, value: true },
    });
    const fdates = new Map<string, Set<string>>();
    const csCodes = new Map<string, Set<string>>();
    for (const r of fv) {
      const key = `${r.factor}|${r.tradeDate}`;
      let m = this.factorByKey.get(key);
      if (!m) {
        m = new Map();
        this.factorByKey.set(key, m);
      }
      m.set(r.tsCode, r.value);

      (fdates.get(r.factor) ?? fdates.set(r.factor, new Set()).get(r.factor)!).add(r.tradeDate);
      (csCodes.get(r.tradeDate) ?? csCodes.set(r.tradeDate, new Set()).get(r.tradeDate)!).add(
        r.tsCode,
      );
    }
    for (const [name, set] of fdates) this.factorDates.set(name, [...set].sort());
    this.csCodesByDate = csCodes;
    this.csDates = [...csCodes.keys()].sort();
  }

  nextDay(date: string): string {
    return this.nextDayOf.get(date) ?? date;
  }

  /** Tradable cross-section as of `date` = codes in the latest factor cross-section ≤ date. */
  universe(date: string): string[] {
    const j = leFloor(this.csDates, date);
    if (j < 0) return [];
    return [...this.csCodesByDate.get(this.csDates[j])!];
  }

  /** Factor value as of `date` (latest factor date ≤ date), or null. */
  factor(name: string, date: string, code: string): number | null {
    const dates = this.factorDates.get(name);
    if (!dates) return null;
    const j = leFloor(dates, date);
    if (j < 0) return null;
    return this.factorByKey.get(`${name}|${dates[j]}`)?.get(code) ?? null;
  }

  /** Batch-load (and cache) daily bars for any codes not yet cached. */
  async loadBars(codes: string[]): Promise<void> {
    const missing = codes.filter((c) => !this.barsCache.has(c));
    if (missing.length === 0) return;
    const [px, adj] = await Promise.all([
      prisma.daily.findMany({
        where: { tsCode: { in: missing }, tradeDate: { gte: this.start, lte: this.end } },
        select: { tsCode: true, tradeDate: true, open: true, close: true },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
      }),
      prisma.adjFactor.findMany({
        where: { tsCode: { in: missing }, tradeDate: { gte: this.start, lte: this.end } },
        select: { tsCode: true, tradeDate: true, adjFactor: true },
      }),
    ]);
    const adjMap = new Map(adj.map((a) => [`${a.tsCode}|${a.tradeDate}`, a.adjFactor]));
    const tmp = new Map<string, StockBars>();
    for (const c of missing) tmp.set(c, { dates: [], adjOpen: [], adjClose: [], idx: new Map() });
    for (const r of px) {
      if (r.open == null || r.close == null) continue;
      const f = adjMap.get(`${r.tsCode}|${r.tradeDate}`);
      if (f == null) continue;
      const b = tmp.get(r.tsCode)!;
      b.idx.set(r.tradeDate, b.dates.length);
      b.dates.push(r.tradeDate);
      b.adjOpen.push(r.open * f);
      b.adjClose.push(r.close * f);
    }
    for (const [c, b] of tmp) this.barsCache.set(c, b);
  }

  /** Adjusted open on exactly `date` (null if the stock didn't trade that day). */
  openAt(code: string, date: string): number | null {
    const b = this.barsCache.get(code);
    if (!b) return null;
    const i = b.idx.get(date);
    return i == null ? null : b.adjOpen[i];
  }

  /** Adjusted close as of `date`, carried forward from the last trading day ≤ date (for marking). */
  closeAt(code: string, date: string): number | null {
    const b = this.barsCache.get(code);
    if (!b) return null;
    const i = b.idx.get(date);
    if (i != null) return b.adjClose[i];
    const j = leFloor(b.dates, date);
    return j < 0 ? null : b.adjClose[j];
  }

  /** Last n adjusted closes up to and including `date` (empty if not cached). */
  history(code: string, date: string, n: number): number[] {
    const b = this.barsCache.get(code);
    if (!b) return [];
    let end = b.idx.get(date);
    if (end == null) {
      end = leFloor(b.dates, date);
      if (end < 0) return [];
    }
    return b.adjClose.slice(Math.max(0, end - n + 1), end + 1);
  }
}

/** Index of the largest element ≤ target in a sorted string array (-1 if none). */
function leFloor(sorted: string[], target: string): number {
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
