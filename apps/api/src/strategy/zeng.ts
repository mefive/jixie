import { prisma } from '../lib/prisma.js';
import { minusDays } from '../lib/date.js';
import { kdj } from '../lib/indicators.js';
import type { Strategy } from '../engine/types.js';

/**
 * Zeng Qinghui strategy — Phase 1: market-breadth timing (the buy_date queue).
 *
 * For each stock, anchored at a candidate day B (the "buy_date"), check the washout pattern:
 *   1. close[B-n] > close[B]            n-day pullback into B
 *   2. close[B+1] < high[B]
 *   3. close[B+8 .. B+21] all < high[B] suppressed below B's high for ~3 weeks
 *   4. J[B+21] < 20                      oversold (KDJ 9,3,3) by the end of that window
 * Daily breadth = (stocks satisfying 1–4) / (evaluable stocks). A buy_date is a *local peak* of that
 * breadth, not a fixed threshold (empirically even major bottoms only reach ~50%): see selectBuyDates.
 *
 * Indices are per-stock trading-day offsets (bars), all on backward-adjusted prices. The pattern is
 * only confirmable at B+21, so the actually-tradable entry is the market trading day 21 bars after B.
 */
export interface BreadthOpts {
  start: string;
  end: string;
  n?: number; // pullback window (default 20)
  consolidStart?: number; // consolidation window start offset (default 8)
  consolidEnd?: number; // consolidation window end offset (default 21)
  jThreshold?: number; // oversold J cutoff (default 20)
  minStocks?: number; // ignore days with fewer evaluable stocks than this (default 100)
  indexCodes?: string[]; // restrict breadth to these indices' PIT constituents, unioned (e.g. CSI1800)
}

/** Point-in-time index membership (union of the given indices): for each calendar day, the
 * constituents of the latest snapshot on or before it. Also returns every code ever a member. */
async function loadMembership(
  indexCodes: string[],
  calendar: string[],
): Promise<{ memberAt: Map<string, Set<string>>; ever: Set<string> }> {
  const rows = await prisma.indexWeight.findMany({
    where: { indexCode: { in: indexCodes } },
    select: { conCode: true, tradeDate: true },
    orderBy: { tradeDate: 'asc' },
  });
  const bySnap = new Map<string, Set<string>>();
  const ever = new Set<string>();
  for (const r of rows) {
    (bySnap.get(r.tradeDate) ?? bySnap.set(r.tradeDate, new Set()).get(r.tradeDate)!).add(
      r.conCode,
    );
    ever.add(r.conCode);
  }
  const snaps = [...bySnap.keys()].sort();
  const memberAt = new Map<string, Set<string>>();
  let si = -1;
  for (const day of calendar) {
    while (si + 1 < snaps.length && snaps[si + 1] <= day) {
      si++;
    }
    if (si >= 0) {
      memberAt.set(day, bySnap.get(snaps[si])!);
    } // else: no snapshot yet → no universe
  }
  return { memberAt, ever };
}

export interface BreadthRow {
  date: string;
  breadth: number; // satisfied / evaluable
  satisfied: number;
  evaluable: number;
}

export interface BreadthSeries {
  calendar: string[]; // full market trading days in range (for B → entry mapping)
  rows: BreadthRow[]; // ascending; only days with ≥ minStocks evaluable
}

/** Heavy step: compute the daily washout breadth across the whole market (one pass over all stocks). */
export async function computeBreadthSeries(opts: BreadthOpts): Promise<BreadthSeries> {
  const n = opts.n ?? 20;
  const cs = opts.consolidStart ?? 8;
  const ce = opts.consolidEnd ?? 21;
  const jt = opts.jThreshold ?? 20;
  const minStocks = opts.minStocks ?? 100;

  const cal = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gte: opts.start, lte: opts.end } },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const calendar = cal.map((c) => c.calDate);
  const inRange = new Set(calendar);

  // Optional point-in-time index universe (e.g. CSI 1800 = 000906 ∪ 000852): only count a stock
  // toward a day's breadth when it was a constituent as-of that day.
  const membership = opts.indexCodes?.length
    ? await loadMembership(opts.indexCodes, calendar)
    : null;

  const satisfied = new Map<string, number>();
  const evaluable = new Map<string, number>();

  const allStocks = await prisma.daily.findMany({
    distinct: ['tsCode'],
    select: { tsCode: true },
    orderBy: { tsCode: 'asc' },
  });
  // When restricting to an index, only stocks that were ever members can contribute — skip the rest.
  const stocks = membership ? allStocks.filter((s) => membership.ever.has(s.tsCode)) : allStocks;
  const listDateMap = new Map(
    (await prisma.stockBasic.findMany({ select: { tsCode: true, listDate: true } })).map((s) => [
      s.tsCode,
      s.listDate,
    ]),
  );

  let processed = 0;
  for (const { tsCode } of stocks) {
    const [px, adj] = await Promise.all([
      prisma.daily.findMany({
        where: { tsCode },
        select: { tradeDate: true, high: true, low: true, close: true },
        orderBy: { tradeDate: 'asc' },
      }),
      prisma.adjFactor.findMany({
        where: { tsCode },
        select: { tradeDate: true, adjFactor: true },
        orderBy: { tradeDate: 'asc' },
      }),
    ]);
    const adjMap = new Map(adj.map((a) => [a.tradeDate, a.adjFactor]));
    const listDate = listDateMap.get(tsCode);

    const d: string[] = [];
    const H: number[] = [];
    const L: number[] = [];
    const C: number[] = [];
    let lastAdj: number | null = null;
    for (const r of px) {
      if (r.close == null || r.high == null || r.low == null) {
        continue;
      }
      if (listDate && r.tradeDate < listDate) {
        continue;
      }
      const a = adjMap.get(r.tradeDate);
      if (a != null) {
        lastAdj = a;
      }
      if (lastAdj == null) {
        continue;
      }
      d.push(r.tradeDate);
      H.push(r.high * lastAdj);
      L.push(r.low * lastAdj);
      C.push(r.close * lastAdj);
    }
    const len = C.length;
    if (len < n + ce + 1) {
      continue;
    }
    const { j } = kdj(H, L, C);

    for (let i = 0; i < len; i++) {
      if (i - n < 0 || i + ce >= len) {
        continue;
      }
      const B = d[i];
      if (!inRange.has(B)) {
        continue;
      }
      if (membership && !membership.memberAt.get(B)?.has(tsCode)) {
        continue;
      } // PIT index member only
      evaluable.set(B, (evaluable.get(B) ?? 0) + 1);
      if (!(C[i - n] > C[i])) {
        continue;
      } // 1
      if (!(C[i + 1] < H[i])) {
        continue;
      } // 2
      let ok = true; // 3
      for (let k = cs; k <= ce; k++) {
        if (!(C[i + k] < H[i])) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        continue;
      }
      if (!(j[i + ce] < jt)) {
        continue;
      } // 4
      satisfied.set(B, (satisfied.get(B) ?? 0) + 1);
    }

    if (++processed % 1000 === 0) {
      console.log(`  …已处理 ${processed}/${stocks.length} 只`);
    }
  }

  const rows: BreadthRow[] = [];
  for (const date of calendar) {
    const ev = evaluable.get(date) ?? 0;
    if (ev < minStocks) {
      continue;
    }
    const sat = satisfied.get(date) ?? 0;
    rows.push({ date, breadth: sat / ev, satisfied: sat, evaluable: ev });
  }
  return { calendar, rows };
}

export interface BuyDate {
  buyDate: string; // B — the washout anchor (breadth local peak)
  entryDate: string; // B + consolidEnd trading days (signal confirms; tradable)
  breadth: number;
  satisfied: number;
  evaluable: number;
}

export interface PeakOpts {
  floor?: number; // minimum breadth to qualify as a washout (default 0.15)
  lookback?: number; // trailing window the day must be the breadth-max of (default 60 trading days)
  minGap?: number; // minimum trading days between consecutive buy_dates (default 60)
  consolidEnd?: number; // entry offset B+ce, must match the breadth computation (default 21)
}

/**
 * Pick buy_dates as causal local peaks of breadth: a day qualifies when its breadth ≥ floor and is
 * the maximum over the *trailing* `lookback` days (breadth at day d embeds data through d+21, so only
 * trailing comparison stays look-ahead-free given entry at B+21). minGap stops one bottom from firing
 * repeatedly. Pure + cheap, so peak params can be retuned without recomputing the breadth series.
 */
export function selectBuyDates(series: BreadthSeries, opts: PeakOpts = {}): BuyDate[] {
  const floor = opts.floor ?? 0.15;
  const lookback = opts.lookback ?? 60;
  const minGap = opts.minGap ?? 60;
  const ce = opts.consolidEnd ?? 21;
  const calIdx = new Map(series.calendar.map((d, i) => [d, i]));
  const { rows } = series;

  const out: BuyDate[] = [];
  let lastIdx = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const b = rows[i].breadth;
    if (b < floor) {
      continue;
    }
    let isMax = true;
    for (let k = Math.max(0, i - lookback); k < i; k++) {
      if (rows[k].breadth > b) {
        isMax = false;
        break;
      }
    }
    if (!isMax) {
      continue;
    }
    if (i - lastIdx < minGap) {
      continue;
    }
    lastIdx = i;
    const ei = (calIdx.get(rows[i].date) ?? 0) + ce;
    out.push({
      buyDate: rows[i].date,
      entryDate: ei < series.calendar.length ? series.calendar[ei] : rows[i].date,
      breadth: b,
      satisfied: rows[i].satisfied,
      evaluable: rows[i].evaluable,
    });
  }
  return out;
}

/** Convenience for Phase 2: compute breadth then select buy_dates in one call. */
export async function computeBuyDates(opts: BreadthOpts & PeakOpts): Promise<BuyDate[]> {
  const series = await computeBreadthSeries(opts);
  return selectBuyDates(series, { ...opts, consolidEnd: opts.consolidEnd ?? 21 });
}

// —— Phase 2: stock selection on entry dates ————————————————————————————————————

interface MaSet {
  short: number;
  shortPrev: number;
  long: number;
  longPrev: number;
}

/** Moving averages today and yesterday from an ascending close series; null if too short. */
function maSet(closes: number[], short: number, long: number): MaSet | null {
  const len = closes.length;
  if (len < long + 1) {
    return null;
  }
  const mean = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i <= to; i++) {
      s += closes[i];
    }
    return s / (to - from + 1);
  };
  return {
    short: mean(len - short, len - 1),
    shortPrev: mean(len - short - 1, len - 2),
    long: mean(len - long, len - 1),
    longPrev: mean(len - long - 1, len - 2),
  };
}

/** Backward-adjusted close windows ending at `endDate` (≈ `tradingDays` bars each). Pass `codes` to
 * restrict to a small candidate set (keeps daily in-window screening cheap). */
async function loadCloseWindows(
  endDate: string,
  tradingDays: number,
  codes?: string[],
): Promise<Map<string, number[]>> {
  const startWin = minusDays(endDate, Math.ceil(tradingDays * 1.7) + 15); // generous calendar span
  const dateWhere = { gte: startWin, lte: endDate };
  const codeWhere = codes ? { tsCode: { in: codes } } : {};
  const [px, adj] = await Promise.all([
    prisma.daily.findMany({
      where: { ...codeWhere, tradeDate: dateWhere },
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    prisma.adjFactor.findMany({
      where: { ...codeWhere, tradeDate: dateWhere },
      select: { tsCode: true, tradeDate: true, adjFactor: true },
    }),
  ]);
  const adjMap = new Map(adj.map((a) => [`${a.tsCode}|${a.tradeDate}`, a.adjFactor]));
  const out = new Map<string, number[]>();
  for (const r of px) {
    if (r.close == null) {
      continue;
    }
    const f = adjMap.get(`${r.tsCode}|${r.tradeDate}`);
    if (f == null) {
      continue;
    }
    (out.get(r.tsCode) ?? out.set(r.tsCode, []).get(r.tsCode)!).push(r.close * f);
  }
  return out;
}

export interface ZengOpts {
  start: string;
  end: string;
  buyDates?: BuyDate[]; // precomputed Phase-1 queue; if omitted it's computed here
  indexCodes?: string[]; // PIT universe for the breadth timing (default CSI1800 = 000906 ∪ 000852)
  breadthGate?: number; // breadth threshold for a buy_date (default 0.3)
  roeMin?: number; // each year's ROE must exceed this % (default 13)
  roeYears?: number; // consecutive annual reports required (default 5)
  roeField?: 'roe' | 'roeWaa'; // which ROE column (default 'roe')
  divYears?: number; // consecutive years of paid dividends required (default 5)
  dvRatioMin?: number; // current TTM dividend yield must exceed this % (default 2)
  maShort?: number; // fast MA (default 20)
  maLong?: number; // slow MA (default 90)
  unitCash?: number; // cash per unit (default 100_000 = 2M / 20)
  maxUnits?: number; // max concurrent units/positions (default 20)
  windowDays?: number; // accumulation window after each buy_date, in trading days (default 60)
  name?: string;
}

/**
 * Zeng Qinghui strategy — Phase 2: buy quality high-dividend names on the Phase-1 entry dates, exit on a
 * MA death cross. All fundamental reads are point-in-time (gated by announcement / ex-dividend date).
 *
 * On each entry date, screen the tradable cross-section for:
 *   ROE > roeMin in each of the last roeYears annual reports · dividends paid in roeYears consecutive
 *   years AND current TTM yield > dvRatioMin · MA20 rising · MA90 rising · MA20 > MA90.
 * Buy 1 unit (unitCash) of each qualifier, up to maxUnits concurrent positions. Any held name whose
 * MA20 falls below MA90 is exited. Returns an async-built Strategy for runStrategy().
 */
export async function makeZengStrategy(opts: ZengOpts): Promise<Strategy> {
  const roeMin = opts.roeMin ?? 13;
  const roeYears = opts.roeYears ?? 5;
  const roeField = opts.roeField ?? 'roe';
  const divYears = opts.divYears ?? 5;
  const dvRatioMin = opts.dvRatioMin ?? 2;
  const maShort = opts.maShort ?? 20;
  const maLong = opts.maLong ?? 90;
  const unitCash = opts.unitCash ?? 100_000;
  const maxUnits = opts.maxUnits ?? 20;
  const windowDays = opts.windowDays ?? 60;

  const buyDates =
    opts.buyDates ??
    (await computeBuyDates({
      start: opts.start,
      end: opts.end,
      indexCodes: opts.indexCodes ?? ['000906.SH', '000852.SH'], // CSI1800
      floor: opts.breadthGate ?? 0.3, // breadth ≥ gate (threshold mode, not local-peak)
      lookback: 0,
      minGap: 20,
    }));
  const entrySet = new Set(buyDates.map((b) => b.entryDate));

  // Preload financials; PIT gating is applied at read time, not here.
  const roeRows = await prisma.finaIndicator.findMany({
    where: { endDate: { endsWith: '1231' } },
    select: { tsCode: true, endDate: true, annDate: true, roe: true, roeWaa: true },
  });
  const roeByStock = new Map<string, typeof roeRows>();
  for (const r of roeRows) {
    (roeByStock.get(r.tsCode) ?? roeByStock.set(r.tsCode, []).get(r.tsCode)!).push(r);
  }
  for (const arr of roeByStock.values()) {
    arr.sort((a, b) => b.endDate.localeCompare(a.endDate));
  }

  const divRows = await prisma.dividend.findMany({
    where: { divProc: '实施' },
    select: { tsCode: true, endDate: true, annDate: true, exDate: true, cashDiv: true },
  });
  const divByStock = new Map<string, typeof divRows>();
  for (const r of divRows) {
    (divByStock.get(r.tsCode) ?? divByStock.set(r.tsCode, []).get(r.tsCode)!).push(r);
  }

  const roeOk = (code: string, date: string): boolean => {
    const arr = roeByStock.get(code);
    if (!arr) {
      return false;
    }
    const known = arr.filter((r) => (r.annDate ?? '99999999') <= date); // PIT: announced by `date`
    if (known.length < roeYears) {
      return false;
    }
    for (let i = 0; i < roeYears; i++) {
      const v = roeField === 'roeWaa' ? known[i].roeWaa : known[i].roe;
      if (v == null || v <= roeMin) {
        return false;
      }
    }
    return true;
  };

  const divOk = (code: string, date: string): boolean => {
    const arr = divByStock.get(code);
    if (!arr) {
      return false;
    }
    const years = new Set<number>();
    for (const r of arr) {
      const gate = r.exDate ?? r.annDate ?? '99999999'; // PIT: effective by `date`
      if (gate > date) {
        continue;
      }
      if (!(r.cashDiv && r.cashDiv > 0)) {
        continue;
      }
      years.add(+r.endDate.slice(0, 4));
    }
    if (years.size < divYears) {
      return false;
    }
    const maxY = Math.max(...years);
    for (let y = maxY; y > maxY - divYears; y--) {
      if (!years.has(y)) {
        return false;
      }
    } // consecutive
    return true;
  };

  let windowRemaining = 0; // trading days left in the current accumulation window

  return {
    name: opts.name ?? 'zeng-曾庆辉',
    async onBar(ctx) {
      const date = ctx.date;

      // Exits (every day): a held name whose MA20 falls below MA90.
      for (const p of ctx.positions()) {
        const ma = maSet(ctx.history(p.code, 'close', maLong + 1), maShort, maLong);
        if (ma && ma.short < ma.long) {
          ctx.exit(p.code);
        }
      }

      // A buy_date (re)opens the accumulation window; buying happens across the whole window, not
      // just on the entry date — names turn MA-bullish gradually after a bottom.
      if (entrySet.has(date)) {
        windowRemaining = windowDays;
      }
      if (windowRemaining <= 0) {
        return;
      }
      windowRemaining--;

      const held = new Set(ctx.positions().map((p) => p.code));
      let slots = maxUnits - held.size;
      if (slots <= 0) {
        return;
      }

      // Cheap prefilter (in-memory): quality + dividend yield. Narrows ~5000 → a few dozen before
      // the (relatively) expensive MA window load, which we then run only for the candidates.
      const universe = await ctx.loadCrossSection();
      const cand: { code: string; adjClose: number | null }[] = [];
      for (const code of universe) {
        if (held.has(code)) {
          continue;
        }
        const bar = ctx.bar(code);
        if (!bar || bar.dvRatio == null || bar.dvRatio <= dvRatioMin) {
          continue;
        } // dividend yield > 2%
        if (!roeOk(code, date)) {
          continue;
        } // ROE each year > 13
        if (!divOk(code, date)) {
          continue;
        } // 5 consecutive years of dividends
        cand.push({ code, adjClose: bar.adjClose });
      }
      if (!cand.length) {
        return;
      }

      const closes = await loadCloseWindows(
        date,
        maLong,
        cand.map((c) => c.code),
      );
      for (const { code, adjClose } of cand) {
        if (slots <= 0) {
          break;
        }
        const ma = maSet(closes.get(code) ?? [], maShort, maLong);
        if (!ma) {
          continue;
        }
        if (!(ma.short > ma.shortPrev && ma.long > ma.longPrev && ma.short > ma.long)) {
          continue;
        } // MA bullish alignment
        if (adjClose == null || adjClose <= 0) {
          continue;
        }
        ctx.order(code, Math.floor(unitCash / adjClose));
        slots--;
        held.add(code);
      }
    },
  };
}
