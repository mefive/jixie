import { prisma } from '../lib/prisma.js';
import { daysBetween } from '../lib/date.js';
import type { BarRow, OhlcBar } from './types.js';

/** Whole-market cross-section for one trading day. */
export interface CrossSection {
  codes: string[]; // tradable codes that day (ascending), the rankable universe
  byCode: Map<string, BarRow>;
}

interface StockBars {
  dates: string[]; // ascending trading days
  adjOpen: number[];
  adjHigh: number[];
  adjLow: number[];
  adjClose: number[];
  idx: Map<string, number>; // date -> index (exact)
}

/**
 * Data access for the engine. Three layers, each loaded the cheapest way for how it's read:
 *
 *  1. Calendar + list dates — preloaded once (tiny).
 *  2. Per-date cross-section — the whole-market valuation + adjusted OHLC panel for a single day,
 *     lazily loaded and cached on first access. Cross-sectional strategies only inspect their
 *     rebalance days, so only those days are ever loaded (bounded memory, no whole-panel preload).
 *  3. Per-stock bar series — lazily loaded and cached per code; only stocks actually held/traded get
 *     loaded. Used for fills, daily marking, and price-window history on holdings.
 *
 * Optionally preloads named precomputed factor columns (FactorValue) when a strategy declares them;
 * these are exposed as-of (latest value ≤ the queried date). The engine attaches no meaning to them.
 */
export class EngineData {
  timeline: string[] = [];
  private nextDayOf = new Map<string, string>();
  private listDateOf = new Map<string, string>();
  private crossCache = new Map<string, CrossSection>();
  private barsCache = new Map<string, StockBars>();
  private factorByKey = new Map<string, Map<string, number>>(); // `${factor}|${date}` -> code -> value
  private factorDates = new Map<string, string[]>(); // factor -> ascending dates it has values on

  constructor(
    private start: string,
    private end: string,
    private factorKeys: string[] = [],
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

    // List dates: used for the point-in-time "stock age" primitive (exclude recently-listed).
    const sb = await prisma.stockBasic.findMany({ select: { tsCode: true, listDate: true } });
    for (const s of sb) this.listDateOf.set(s.tsCode, s.listDate);

    // Optional precomputed factor columns (only the ones a strategy asked for).
    if (this.factorKeys.length) {
      const fv = await prisma.factorValue.findMany({
        where: { factor: { in: this.factorKeys }, tradeDate: { gte: this.start, lte: this.end } },
        select: { factor: true, tsCode: true, tradeDate: true, value: true },
      });
      const dates = new Map<string, Set<string>>();
      for (const r of fv) {
        const key = `${r.factor}|${r.tradeDate}`;
        let m = this.factorByKey.get(key);
        if (!m) this.factorByKey.set(key, (m = new Map()));
        m.set(r.tsCode, r.value);
        (dates.get(r.factor) ?? dates.set(r.factor, new Set()).get(r.factor)!).add(r.tradeDate);
      }
      for (const [name, set] of dates) this.factorDates.set(name, [...set].sort());
    }
  }

  nextDay(date: string): string {
    return this.nextDayOf.get(date) ?? date;
  }

  /** Calendar days since listing as of `date` (point-in-time stock age), or null if unknown. */
  listDays(code: string, date: string): number | null {
    const ld = this.listDateOf.get(code);
    return ld ? daysBetween(ld, date) : null;
  }

  /**
   * Whole-market cross-section for `date` (lazy + cached). A code is included only if it has a daily
   * bar, an adjustment factor, and a valuation row that day (i.e. it actually traded with valuation).
   */
  async crossSection(date: string): Promise<CrossSection> {
    const hit = this.crossCache.get(date);
    if (hit) return hit;

    const [px, adj, db] = await Promise.all([
      prisma.daily.findMany({
        where: { tradeDate: date },
        select: { tsCode: true, open: true, high: true, low: true, close: true },
      }),
      prisma.adjFactor.findMany({
        where: { tradeDate: date },
        select: { tsCode: true, adjFactor: true },
      }),
      prisma.dailyBasic.findMany({
        where: { tradeDate: date },
        orderBy: { tsCode: 'asc' },
      }),
    ]);
    const pxMap = new Map(px.map((r) => [r.tsCode, r]));
    const adjMap = new Map(adj.map((a) => [a.tsCode, a.adjFactor]));

    const codes: string[] = [];
    const byCode = new Map<string, BarRow>();
    for (const r of db) {
      const p = pxMap.get(r.tsCode);
      const f = adjMap.get(r.tsCode);
      if (!p || f == null || p.close == null) continue; // not tradable that day
      byCode.set(r.tsCode, {
        code: r.tsCode,
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        adjOpen: p.open == null ? null : p.open * f,
        adjHigh: p.high == null ? null : p.high * f,
        adjLow: p.low == null ? null : p.low * f,
        adjClose: p.close * f,
        pe: r.pe,
        peTtm: r.peTtm,
        pb: r.pb,
        ps: r.ps,
        psTtm: r.psTtm,
        dvRatio: r.dvRatio,
        dvTtm: r.dvTtm,
        totalMv: r.totalMv,
        circMv: r.circMv,
        turnoverRate: r.turnoverRate,
      });
      codes.push(r.tsCode);
    }
    const cs: CrossSection = { codes, byCode };
    this.crossCache.set(date, cs);
    return cs;
  }

  /** Precomputed factor value as-of `date` (latest factor date ≤ date), or null. */
  factor(name: string, date: string, code: string): number | null {
    const dates = this.factorDates.get(name);
    if (!dates) return null;
    const j = leFloor(dates, date);
    if (j < 0) return null;
    return this.factorByKey.get(`${name}|${dates[j]}`)?.get(code) ?? null;
  }

  /** Batch-load (and cache) daily adjusted bar series for any codes not yet cached. */
  async loadBars(codes: string[]): Promise<void> {
    const missing = codes.filter((c) => !this.barsCache.has(c));
    if (missing.length === 0) return;
    const [px, adj] = await Promise.all([
      prisma.daily.findMany({
        where: { tsCode: { in: missing }, tradeDate: { gte: this.start, lte: this.end } },
        select: { tsCode: true, tradeDate: true, open: true, high: true, low: true, close: true },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
      }),
      prisma.adjFactor.findMany({
        where: { tsCode: { in: missing }, tradeDate: { gte: this.start, lte: this.end } },
        select: { tsCode: true, tradeDate: true, adjFactor: true },
      }),
    ]);
    const adjMap = new Map(adj.map((a) => [`${a.tsCode}|${a.tradeDate}`, a.adjFactor]));
    const tmp = new Map<string, StockBars>();
    for (const c of missing) {
      tmp.set(c, { dates: [], adjOpen: [], adjHigh: [], adjLow: [], adjClose: [], idx: new Map() });
    }
    for (const r of px) {
      if (r.open == null || r.high == null || r.low == null || r.close == null) continue;
      const f = adjMap.get(`${r.tsCode}|${r.tradeDate}`);
      if (f == null) continue;
      const b = tmp.get(r.tsCode)!;
      b.idx.set(r.tradeDate, b.dates.length);
      b.dates.push(r.tradeDate);
      b.adjOpen.push(r.open * f);
      b.adjHigh.push(r.high * f);
      b.adjLow.push(r.low * f);
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

  /** Last n adjusted prices (open|high|low|close) up to and including `date` (empty if not cached). */
  history(code: string, date: string, field: 'open' | 'high' | 'low' | 'close', n: number): number[] {
    const b = this.barsCache.get(code);
    if (!b) return [];
    const end = this.endIndex(b, date);
    if (end < 0) return [];
    const series =
      field === 'open' ? b.adjOpen : field === 'high' ? b.adjHigh : field === 'low' ? b.adjLow : b.adjClose;
    return series.slice(Math.max(0, end - n + 1), end + 1);
  }

  /** Last n adjusted OHLC bars up to and including `date` (empty if not cached). */
  bars(code: string, date: string, n: number): OhlcBar[] {
    const b = this.barsCache.get(code);
    if (!b) return [];
    const end = this.endIndex(b, date);
    if (end < 0) return [];
    const out: OhlcBar[] = [];
    for (let i = Math.max(0, end - n + 1); i <= end; i++) {
      out.push({
        date: b.dates[i],
        adjOpen: b.adjOpen[i],
        adjHigh: b.adjHigh[i],
        adjLow: b.adjLow[i],
        adjClose: b.adjClose[i],
      });
    }
    return out;
  }

  /** Index of the bar on `date`, or the last bar before it (-1 if none); used by history/bars. */
  private endIndex(b: StockBars, date: string): number {
    const exact = b.idx.get(date);
    return exact != null ? exact : leFloor(b.dates, date);
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
