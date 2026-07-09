import {
  DEFAULT_LOCALE,
  ENGINE_FACTORS,
  isCustomFactorKey,
  type EngineFactorDef,
  type Locale,
} from '@jixie/shared';
import { daysBetween } from '../lib/date.js';
import { t } from '../i18n/messages.js'; // direct import — keeps hono/locale out of the wall bundle
import type { EngineDataPort } from './data-port.js';
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
  adj: number[]; // per-date adj_factor — to convert a hfq fill back to real shares/price (whole-lot sizing)
  up: (number | null)[]; // raw up-limit price (null if not synced) — block buys at the up-limit open
  down: (number | null)[]; // raw down-limit price
  vol: (number | null)[]; // raw (not adjusted)
  amount: (number | null)[];
  idx: Map<string, number>; // date -> index (exact)
}

// Stored ("column") factors the engine can preload, keyed for the semantics lookup in factor().
const COLUMN_FACTOR_DEFS = new Map<string, EngineFactorDef>(
  ENGINE_FACTORS.filter((def) => def.source === 'column').map((def) => [def.key, def]),
);

// How stale a `level` as-of read may be, per data frequency: long enough to bridge holidays and
// report gaps, short enough that a dead series stops answering. (Calendar days.)
const DAILY_ASOF_CAP_DAYS = 14;
const MONTHLY_ASOF_CAP_DAYS = 35;

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
  private industryOf = new Map<string, string>(); // code -> industry label (current, not point-in-time)
  private lhbByDate = new Map<string, Map<string, number>>(); // Dragon-Tiger List: date -> code -> net buy amount (yuan), exact day only
  private crossCache = new Map<string, CrossSection>();
  private barsCache = new Map<string, StockBars>();
  private factorByKey = new Map<string, Map<string, number>>(); // `${factor}|${date}` -> code -> value
  private factorDates = new Map<string, string[]>(); // factor -> ascending dates it has values on
  // Point-in-time fundamentals (ROE), loaded lazily on first cross-section build (cross-section work is
  // the only place they're read). code -> reports ascending by annDate.
  private finaByCode = new Map<
    string,
    { annDate: string; roe: number | null; roeWaa: number | null }[]
  >();
  private finaLoaded = false;
  // Index constituents per index, loaded lazily. indexCode -> { dates ascending, members per date }.
  private indexCache = new Map<
    string,
    { dates: string[]; membersByDate: Map<string, Set<string>> }
  >();
  // Index daily close (all synced indices, preloaded in load()) — ascending parallel dates/closes arrays.
  // Powers the excess-return/IR benchmark + ctx.index() market timing. Tiny (a few thousand rows), so always loaded.
  private indexByCode = new Map<string, { dates: string[]; closes: number[] }>();

  private warnedIndices = new Set<string>(); // log an index's coverage gap at most once

  constructor(
    private start: string,
    private end: string,
    private factorKeys: string[] = [],
    private onLog: (line: string) => void = () => {},
    private locale: Locale = DEFAULT_LOCALE,
    // All storage access goes through this port (Phase B1): prismaDataPort on the direct lane,
    // the isolate bridge on the walled lane (Phase B2). Domain logic stays in this class.
    private port: EngineDataPort,
  ) {}

  /** Index daily close series (sync, from the preload) — the excess-return/IR benchmark (caller aligns to nav). */
  indexCloses(code: string): { date: string; close: number }[] {
    const s = this.indexByCode.get(code);
    return s ? s.dates.map((date, i) => ({ date, close: s.closes[i] })) : [];
  }

  /** Index close as-of `date` (latest index date ≤ date); null if the index isn't synced / no data yet.
   * Powers ctx.index(code).close — point-in-time, no forward data. */
  indexCloseAsOf(code: string, date: string): number | null {
    const s = this.indexByCode.get(code);
    if (!s) {
      return null;
    }
    const i = lastIndexAtOrBefore(s.dates, date);
    return i >= 0 ? s.closes[i] : null;
  }

  /** n-day SMA of an index's close as-of `date` (point-in-time); null if fewer than n closes exist yet. */
  indexSma(code: string, date: string, n: number): number | null {
    const s = this.indexByCode.get(code);
    if (!s) {
      return null;
    }
    const i = lastIndexAtOrBefore(s.dates, date);
    if (i < n - 1) {
      return null;
    }
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) {
      sum += s.closes[k];
    }
    return sum / n;
  }

  async load(): Promise<void> {
    this.timeline = await this.port.openDates(this.start, this.end);
    for (let i = 0; i < this.timeline.length - 1; i++) {
      this.nextDayOf.set(this.timeline[i], this.timeline[i + 1]);
    }

    // List dates: used for the point-in-time "stock age" primitive (exclude recently-listed).
    // Industry: a current label per stock (Tushare's classification) — for sector-neutral / rotation logic.
    const sb = await this.port.stockBasics();
    for (const s of sb) {
      this.listDateOf.set(s.tsCode, s.listDate);
      if (s.industry) {
        this.industryOf.set(s.tsCode, s.industry);
      }
    }

    // Dragon-Tiger List: sparse event data (~tens/day) — preload the range into date->code->net buy amount for exact-day lookup
    // (never carried forward). Tiny (~50k rows), so loaded for every run regardless of use.
    const lhb = await this.port.topListRange(this.start, this.end);
    for (const r of lhb) {
      let m = this.lhbByDate.get(r.tradeDate);
      if (!m) {
        this.lhbByDate.set(r.tradeDate, (m = new Map()));
      }
      m.set(r.tsCode, r.netAmount);
    }

    // Index daily close (CSI 300 etc.) — preload all (tiny) for excess-return/IR benchmark + ctx.index() market timing.
    const idx = await this.port.indexDailyAll();
    for (const r of idx) {
      let s = this.indexByCode.get(r.tsCode);
      if (!s) {
        this.indexByCode.set(r.tsCode, (s = { dates: [], closes: [] }));
      }
      s.dates.push(r.tradeDate);
      s.closes.push(r.close);
    }

    // Declared factor keys must be real: a registry column factor or a custom:<id> reference —
    // a typo'd key used to be a silent all-null column, which reads as "strategy places no trades".
    for (const key of this.factorKeys) {
      if (!COLUMN_FACTOR_DEFS.has(key) && !isCustomFactorKey(key)) {
        throw new Error(
          t(this.locale, 'unknownEngineFactor', {
            key,
            available: [...COLUMN_FACTOR_DEFS.keys()].join(' / '),
          }),
        );
      }
    }

    // Optional moneyflow columns (opt-in via the strategy's `factors:[...]`). This is the only stored
    // "factor" the engine reads: price-window factors are computed on the fly from the bar series
    // (see strategies.ts), fundamentals come straight from bar() (daily_basic). No FactorValue.
    const mfKeys = this.factorKeys.filter((k) => COLUMN_FACTOR_DEFS.has(k));
    if (mfKeys.length) {
      const dates = new Map<string, Set<string>>();
      const put = (factor: string, tradeDate: string, code: string, value: number) => {
        const key = `${factor}|${tradeDate}`;
        let m = this.factorByKey.get(key);
        if (!m) {
          this.factorByKey.set(key, (m = new Map()));
        }
        m.set(code, value);
        (dates.get(factor) ?? dates.set(factor, new Set()).get(factor)!).add(tradeDate);
      };
      const mf = await this.port.moneyflowRange(this.start, this.end);
      for (const r of mf) {
        if (mfKeys.includes('mf_net_main')) {
          put('mf_net_main', r.tradeDate, r.tsCode, r.netMain);
        }
        if (mfKeys.includes('mf_net_total') && r.netTotal != null) {
          put('mf_net_total', r.tradeDate, r.tsCode, r.netTotal);
        }
      }
      for (const [name, set] of dates) {
        this.factorDates.set(name, [...set].sort());
      }
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

  /** Industry label for `code` (current classification, not point-in-time), or null if unknown. */
  industry(code: string): string | null {
    return this.industryOf.get(code) ?? null;
  }

  /** Today's Dragon-Tiger List net buy amount (yuan) for `code`, or null if it wasn't on the Dragon-Tiger List that exact day (not carried forward). */
  lhbNet(code: string, date: string): number | null {
    return this.lhbByDate.get(date)?.get(code) ?? null;
  }

  /**
   * Tradable cross-section for `date` (lazy + cached). A code is included only if it has a daily bar, an
   * adjustment factor, and a valuation row that day (i.e. it actually traded with valuation).
   *
   * Pass `indexCode` to restrict to that index's point-in-time constituents — the restriction is **pushed
   * into the DB query** (only those rows are read), not filtered in memory afterwards. This is the engine's
   * "universe selection" data gate (cf. LEAN coarse/fine): CSI 300 reads ~300 rows not 5370 (~15×), CSI 2000
   * ~2000 (~2×). Index-scoped panels cache under `indexCode|date`; a full panel under `date`.
   */
  async crossSection(date: string, indexCode?: string): Promise<CrossSection> {
    const cacheKey = indexCode ? `${indexCode}|${date}` : date;
    const hit = this.crossCache.get(cacheKey);
    if (hit) {
      return hit;
    }

    await this.ensureFina();

    let memberCodes: string[] | undefined;
    if (indexCode) {
      const members = await this.indexMembers(indexCode, date); // throws if the index was never synced
      const full = this.crossCache.get(date);
      if (full) {
        // The full-market panel for today is already loaded — derive the index subset from it, no requery.
        const set = new Set(members);
        const byCode = new Map([...full.byCode].filter(([c]) => set.has(c)));
        const cs: CrossSection = { codes: [...byCode.keys()].sort(), byCode };
        this.crossCache.set(cacheKey, cs);
        return cs;
      }
      memberCodes = members;
    }

    const {
      price: priceRows,
      adj: adjRows,
      basic: basicRows,
    } = await this.port.crossSectionRows(date, memberCodes);
    const priceByCode = new Map(priceRows.map((r) => [r.tsCode, r]));
    const adjByCode = new Map(adjRows.map((r) => [r.tsCode, r.adjFactor]));

    const codes: string[] = [];
    const byCode = new Map<string, BarRow>();
    for (const basic of basicRows) {
      const price = priceByCode.get(basic.tsCode);
      const adj = adjByCode.get(basic.tsCode);
      if (!price || adj == null || price.close == null) {
        continue;
      } // not tradable that day
      const fina = this.roeAsOf(basic.tsCode, date);
      byCode.set(basic.tsCode, {
        code: basic.tsCode,
        open: price.open,
        high: price.high,
        low: price.low,
        close: price.close,
        adjOpen: price.open == null ? null : price.open * adj,
        adjHigh: price.high == null ? null : price.high * adj,
        adjLow: price.low == null ? null : price.low * adj,
        adjClose: price.close * adj,
        vol: price.vol,
        amount: price.amount,
        pe: basic.pe,
        peTtm: basic.peTtm,
        pb: basic.pb,
        ps: basic.ps,
        psTtm: basic.psTtm,
        dvRatio: basic.dvRatio,
        dvTtm: basic.dvTtm,
        totalMv: basic.totalMv,
        circMv: basic.circMv,
        turnoverRate: basic.turnoverRate,
        roe: fina?.roe ?? null,
        roeWaa: fina?.roeWaa ?? null,
      });
      codes.push(basic.tsCode);
    }
    codes.sort(); // ascending universe — replaces the dropped DB orderBy, keeps tie-breaks deterministic
    const cs: CrossSection = { codes, byCode };
    this.crossCache.set(cacheKey, cs);
    return cs;
  }

  /** Stored factor value for `date`, honoring the factor's DECLARED time semantics (engine-factors.ts):
   * flow = exact day only (yesterday's inflow is not today's — same rule as lhbNet); level = as-of
   * (latest value ≤ date) capped by the data's frequency, so a stale value can't ride forever. */
  factor(name: string, date: string, code: string): number | null {
    const def = COLUMN_FACTOR_DEFS.get(name);
    if (def?.kind === 'flow') {
      return this.factorByKey.get(`${name}|${date}`)?.get(code) ?? null;
    }

    const dates = this.factorDates.get(name);
    if (!dates) {
      return null;
    }
    const j = lastIndexAtOrBefore(dates, date);
    if (j < 0) {
      return null;
    }
    const lookbackCap = def?.dataFreq === 'monthly' ? MONTHLY_ASOF_CAP_DAYS : DAILY_ASOF_CAP_DAYS;
    if (daysBetween(dates[j], date) > lookbackCap) {
      return null;
    }
    return this.factorByKey.get(`${name}|${dates[j]}`)?.get(code) ?? null;
  }

  /** Load all financial indicators once (PIT-gated by annDate), grouped by code ascending. */
  private async ensureFina(): Promise<void> {
    if (this.finaLoaded) {
      return;
    }
    this.finaLoaded = true;
    const rows = await this.port.finaIndicators();
    for (const r of rows) {
      let list = this.finaByCode.get(r.tsCode);
      if (!list) {
        this.finaByCode.set(r.tsCode, (list = []));
      }
      list.push({ annDate: r.annDate, roe: r.roe, roeWaa: r.roeWaa });
    }
  }

  /** Latest financial report public as-of `date` for `code` (point-in-time), or null. */
  private roeAsOf(
    code: string,
    date: string,
  ): { roe: number | null; roeWaa: number | null } | null {
    const list = this.finaByCode.get(code);
    if (!list || !list.length) {
      return null;
    }
    let lo = 0;
    let hi = list.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].annDate <= date) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans < 0 ? null : list[ans];
  }

  /** Point-in-time constituents of `indexCode` as of `date` (codes from the latest snapshot ≤ date). */
  async indexMembers(indexCode: string, date: string): Promise<string[]> {
    let idx = this.indexCache.get(indexCode);
    if (!idx) {
      const rows = await this.port.indexWeights(indexCode);
      const membersByDate = new Map<string, Set<string>>();
      for (const r of rows) {
        let s = membersByDate.get(r.tradeDate);
        if (!s) {
          membersByDate.set(r.tradeDate, (s = new Set()));
        }
        s.add(r.conCode);
      }
      idx = { dates: [...membersByDate.keys()].sort(), membersByDate };
      this.indexCache.set(indexCode, idx);
    }
    // No snapshots at all = this index's constituents were never synced — fail loudly rather than
    // silently trade nothing (a date before the first snapshot legitimately returns []).
    if (idx.dates.length === 0) {
      throw new Error(t(this.locale, 'indexNoConstituents', { indexCode }));
    }
    const j = lastIndexAtOrBefore(idx.dates, date);
    if (j < 0) {
      // The index exists but has no snapshot on/before today — its data starts later than this date.
      // Warn once so an empty universe (→ no trades) isn't a silent mystery.
      if (!this.warnedIndices.has(indexCode)) {
        this.warnedIndices.add(indexCode);
        this.onLog(t(this.locale, 'indexCoverageGap', { indexCode, date: idx.dates[0] }));
      }
      return [];
    }
    return [...(idx.membersByDate.get(idx.dates[j]) ?? [])];
  }

  /** Batch-load (and cache) daily adjusted bar series for any codes not yet cached. One port call
   * for all missing codes (the direct-lane implementation chunks internally; the walled lane makes
   * it one crossing). */
  async loadBars(codes: string[]): Promise<void> {
    const missing = codes.filter((c) => !this.barsCache.has(c));
    if (missing.length === 0) {
      return;
    }
    const tmp = new Map<string, StockBars>();
    for (const c of missing) {
      tmp.set(c, {
        dates: [],
        adjOpen: [],
        adjHigh: [],
        adjLow: [],
        adjClose: [],
        adj: [],
        up: [],
        down: [],
        vol: [],
        amount: [],
        idx: new Map(),
      });
    }

    const { px, adj, limits } = await this.port.barsRows(missing, this.start, this.end);
    const adjMap = new Map(adj.map((row) => [`${row.tsCode}|${row.tradeDate}`, row.adjFactor]));
    const limMap = new Map(limits.map((row) => [`${row.tsCode}|${row.tradeDate}`, row]));
    for (const price of px) {
      if (price.open == null || price.high == null || price.low == null || price.close == null) {
        continue;
      }
      const adjFactor = adjMap.get(`${price.tsCode}|${price.tradeDate}`);
      if (adjFactor == null) {
        continue;
      }
      const series = tmp.get(price.tsCode)!;
      const limit = limMap.get(`${price.tsCode}|${price.tradeDate}`);
      series.idx.set(price.tradeDate, series.dates.length);
      series.dates.push(price.tradeDate);
      series.adjOpen.push(price.open * adjFactor);
      series.adjHigh.push(price.high * adjFactor);
      series.adjLow.push(price.low * adjFactor);
      series.adjClose.push(price.close * adjFactor);
      series.adj.push(adjFactor);
      series.up.push(limit?.upLimit ?? null);
      series.down.push(limit?.downLimit ?? null);
      series.vol.push(price.vol);
      series.amount.push(price.amount);
    }
    for (const [c, b] of tmp) {
      this.barsCache.set(c, b);
    }
  }

  /** Adjusted open on exactly `date` (null if the stock didn't trade that day). */
  openAt(code: string, date: string): number | null {
    const b = this.barsCache.get(code);
    if (!b) {
      return null;
    }
    const i = b.idx.get(date);
    return i == null ? null : b.adjOpen[i];
  }

  /** Raw turnover (thousand yuan) on exactly `date` (null if the stock didn't trade that day) — the day's turnover,
   * the liquidity gate for the slippage/impact model (a big order in a thin name pays more). */
  amountAt(code: string, date: string): number | null {
    const b = this.barsCache.get(code);
    if (!b) {
      return null;
    }
    const i = b.idx.get(date);
    return i == null ? null : b.amount[i];
  }

  /** adj_factor on exactly `date` (null if the stock didn't trade that day) — to convert a hfq fill price
   * (adjOpen) back to the real unadjusted price (adjOpen / adj) and hfq shares back to real (hfq × adj). */
  adjAt(code: string, date: string): number | null {
    const b = this.barsCache.get(code);
    if (!b) {
      return null;
    }
    const i = b.idx.get(date);
    return i == null ? null : b.adj[i];
  }

  /** Raw up/down-limit price on exactly `date` (null if the day's limit wasn't synced) — to block fills at the limit. */
  limitAt(code: string, date: string): { up: number | null; down: number | null } | null {
    const b = this.barsCache.get(code);
    if (!b) {
      return null;
    }
    const i = b.idx.get(date);
    if (i == null) {
      return null;
    }
    return { up: b.up[i], down: b.down[i] };
  }

  /** Adjusted close as of `date`, carried forward from the last trading day ≤ date (for marking). */
  closeAt(code: string, date: string): number | null {
    const b = this.barsCache.get(code);
    if (!b) {
      return null;
    }
    const i = b.idx.get(date);
    if (i != null) {
      return b.adjClose[i];
    }
    const j = lastIndexAtOrBefore(b.dates, date);
    return j < 0 ? null : b.adjClose[j];
  }

  /** Last n adjusted prices (open|high|low|close) up to and including `date` (empty if not cached). */
  history(
    code: string,
    date: string,
    field: 'open' | 'high' | 'low' | 'close',
    n: number,
  ): number[] {
    const b = this.barsCache.get(code);
    if (!b) {
      return [];
    }
    const end = this.endIndex(b, date);
    if (end < 0) {
      return [];
    }
    const series =
      field === 'open'
        ? b.adjOpen
        : field === 'high'
          ? b.adjHigh
          : field === 'low'
            ? b.adjLow
            : b.adjClose;
    return series.slice(Math.max(0, end - n + 1), end + 1);
  }

  /** Last n adjusted OHLC bars up to and including `date` (empty if not cached). */
  bars(code: string, date: string, n: number): OhlcBar[] {
    const b = this.barsCache.get(code);
    if (!b) {
      return [];
    }
    const end = this.endIndex(b, date);
    if (end < 0) {
      return [];
    }
    const out: OhlcBar[] = [];
    for (let i = Math.max(0, end - n + 1); i <= end; i++) {
      out.push({
        date: b.dates[i],
        adjOpen: b.adjOpen[i],
        adjHigh: b.adjHigh[i],
        adjLow: b.adjLow[i],
        adjClose: b.adjClose[i],
        vol: b.vol[i],
        amount: b.amount[i],
      });
    }
    return out;
  }

  /** Index of the bar on `date`, or the last bar before it (-1 if none); used by history/bars. */
  private endIndex(b: StockBars, date: string): number {
    const exact = b.idx.get(date);
    return exact != null ? exact : lastIndexAtOrBefore(b.dates, date);
  }
}

/** Index of the largest element ≤ target in a sorted string array (-1 if none). */
function lastIndexAtOrBefore(sorted: string[], target: string): number {
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
