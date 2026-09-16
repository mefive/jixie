import { sameMonth, sameWeek } from '#date';
import { prisma } from '#infra/database/prisma.js';
import type { FactorAnalysisSpecV6, FactorFreq } from '@jixie/shared';
import type { EquityStyleControlExposureV1 } from './inference.js';

// Rebalance days within [start,end]: the last open day of each month (or ISO week).
export async function getRebalanceDates(
  freq: FactorFreq,
  start: string,
  end: string,
): Promise<string[]> {
  const cal = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gte: start, lte: end } },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const same = freq === 'week' ? sameWeek : sameMonth;
  const out: string[] = [];
  for (let i = 0; i < cal.length; i++) {
    const cur = cal[i].calDate;
    const next = cal[i + 1]?.calDate;
    // Last open day of the period = the next open day falls in a different month/week.
    if (!next || !same(cur, next)) {
      out.push(cur);
    }
  }
  return out;
}

export type Snap = Map<string, { adjClose: number; amount: number; mktcap: number }>; // tsCode -> quote

/** Load a "hfq close + turnover (+ total market cap for cap-weighting)" snapshot for each day. `withMktcap` only
 * for rebalance (formation) dates — forward snapshots weight by the formation-date cap, so they skip it. */
export async function loadSnapshots(
  dates: string[],
  withMktcap = false,
): Promise<Map<string, Snap>> {
  const px = await prisma.daily.findMany({
    where: { tradeDate: { in: dates } },
    select: { tsCode: true, tradeDate: true, close: true, amount: true },
  });
  const adj = await prisma.adjFactor.findMany({
    where: { tradeDate: { in: dates } },
    select: { tsCode: true, tradeDate: true, adjFactor: true },
  });
  const adjMap = new Map(adj.map((a) => [`${a.tsCode}|${a.tradeDate}`, a.adjFactor]));
  let mvMap = new Map<string, number>();
  if (withMktcap) {
    const basic = await prisma.dailyBasic.findMany({
      where: { tradeDate: { in: dates } },
      select: { tsCode: true, tradeDate: true, totalMv: true },
    });
    mvMap = new Map(basic.map((b) => [`${b.tsCode}|${b.tradeDate}`, b.totalMv ?? 0]));
  }
  const snaps = new Map<string, Snap>();
  for (const d of dates) {
    snaps.set(d, new Map());
  }
  for (const r of px) {
    if (r.close == null) {
      continue;
    }
    const f = adjMap.get(`${r.tsCode}|${r.tradeDate}`);
    if (f == null) {
      continue;
    } // skip the rare cases missing an adjustment factor
    snaps.get(r.tradeDate)!.set(r.tsCode, {
      adjClose: r.close * f,
      amount: r.amount ?? 0,
      mktcap: mvMap.get(`${r.tsCode}|${r.tradeDate}`) ?? 0,
    });
  }
  return snaps;
}

// One financial report's as-of fundamentals + the announcement date that gates them (PIT).
type FinaReport = {
  annDate: string;
  roe: number | null;
  roa: number | null;
  grossprofitMargin: number | null;
  debtToAssets: number | null;
};
export type FinaIndex = Map<string, FinaReport[]>; // code -> reports ascending by annDate

/** Load all financial reports once, grouped by code ascending by annDate — the point-in-time source for
 * the FactorBar fundamentals (ROE / ROA / gross margin / debt ratio). Rows without an annDate are
 * skipped (they can't be PIT-gated). Mirrors EngineData.ensureFina so the factor and backtest sides
 * read fina the same way. */
export async function loadFinaIndex(): Promise<FinaIndex> {
  const rows = await prisma.finaIndicator.findMany({
    where: { annDate: { not: null } },
    select: {
      tsCode: true,
      annDate: true,
      roe: true,
      roa: true,
      grossprofitMargin: true,
      debtToAssets: true,
    },
    orderBy: { annDate: 'asc' },
  });
  const index: FinaIndex = new Map();
  for (const r of rows) {
    let list = index.get(r.tsCode);
    if (!list) {
      index.set(r.tsCode, (list = []));
    }
    list.push({
      annDate: r.annDate!,
      roe: r.roe,
      roa: r.roa,
      grossprofitMargin: r.grossprofitMargin,
      debtToAssets: r.debtToAssets,
    });
  }
  return index;
}

/** The latest report public as-of `date` for `code` (largest annDate ≤ date), or null — binary search
 * over the ascending list. Same PIT rule as EngineData.roeAsOf: no report visible before its annDate. */
export function finaAsOf(index: FinaIndex, code: string, date: string): FinaReport | null {
  const list = index.get(code);
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

type EquityStyleControlsByDate = Map<string, Map<string, EquityStyleControlExposureV1>>;

/** Point-in-time, fixed-version controls for the Fama–MacBeth auxiliary regression. Missing control
 * inputs remove a stock from that regression only; they never change the primary report sample. */
export async function loadEquityStyleControls(
  spec: FactorAnalysisSpecV6,
  dates: string[],
  formationSnaps: Map<string, Snap>,
  finaIndex: FinaIndex,
): Promise<EquityStyleControlsByDate> {
  const calendar = (
    await prisma.tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1, calDate: { lte: dates.at(-1) ?? spec.end } },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    })
  ).map((row) => row.calDate);
  const calendarIndex = new Map(calendar.map((date, index) => [date, index]));
  const momentumDates = new Set<string>();
  const momentumPairByDate = new Map<string, { past: string; recent: string }>();
  const { momentumLookbackTradingDays, momentumSkipTradingDays } = spec.inference.famaMacbeth;
  for (const date of dates) {
    const index = calendarIndex.get(date);
    const past = index == null ? undefined : calendar[index - momentumLookbackTradingDays];
    const recent = index == null ? undefined : calendar[index - momentumSkipTradingDays];
    if (!past || !recent) {
      continue;
    }
    momentumDates.add(past);
    momentumDates.add(recent);
    momentumPairByDate.set(date, { past, recent });
  }
  const [momentumSnaps, basicRows] = await Promise.all([
    loadSnapshots([...momentumDates]),
    prisma.dailyBasic.findMany({
      where: { tradeDate: { in: dates } },
      select: { tsCode: true, tradeDate: true, pb: true },
    }),
  ]);
  const bookToPrice = new Map(
    basicRows
      .filter((row) => row.pb != null && row.pb > 0)
      .map((row) => [`${row.tradeDate}|${row.tsCode}`, 1 / row.pb!] as const),
  );
  const controlsByDate: EquityStyleControlsByDate = new Map();
  for (const date of dates) {
    const pair = momentumPairByDate.get(date);
    const current = formationSnaps.get(date);
    const past = pair ? momentumSnaps.get(pair.past) : undefined;
    const recent = pair ? momentumSnaps.get(pair.recent) : undefined;
    const controls = new Map<string, EquityStyleControlExposureV1>();
    if (!current || !past || !recent) {
      controlsByDate.set(date, controls);
      continue;
    }
    for (const [tsCode, snap] of current) {
      const pastQuote = past.get(tsCode);
      const recentQuote = recent.get(tsCode);
      const value = bookToPrice.get(`${date}|${tsCode}`);
      const quality = finaAsOf(finaIndex, tsCode, date)?.roe;
      if (
        snap.mktcap <= 0 ||
        !pastQuote ||
        !recentQuote ||
        pastQuote.adjClose <= 0 ||
        recentQuote.adjClose <= 0 ||
        value == null ||
        quality == null ||
        !Number.isFinite(quality)
      ) {
        continue;
      }
      controls.set(tsCode, {
        size: Math.log(snap.mktcap),
        value,
        momentum: recentQuote.adjClose / pastQuote.adjClose - 1,
        quality,
      });
    }
    controlsByDate.set(date, controls);
  }
  return controlsByDate;
}

export type IndustrySpell = { inDate: string; outDate: string | null; l1Name: string };

/** Load Shenwan level-1 membership once and index it by stock, spells ascending by inDate — the
 * point-in-time (stock → industry) lookup for industry-neutralization. */
export async function loadIndustryLookup(): Promise<Map<string, IndustrySpell[]>> {
  const rows = await prisma.swIndustryMember.findMany({
    select: { tsCode: true, l1Name: true, inDate: true, outDate: true },
    orderBy: { inDate: 'asc' },
  });
  const byStock = new Map<string, IndustrySpell[]>();
  for (const r of rows) {
    const spells = byStock.get(r.tsCode) ?? [];
    spells.push({ inDate: r.inDate, outDate: r.outDate, l1Name: r.l1Name });
    byStock.set(r.tsCode, spells);
  }
  return byStock;
}

/** The stock's SW level-1 industry on `date`: the spell covering [inDate, outDate) — or null if none. */
export function industryOn(spells: IndustrySpell[] | undefined, date: string): string | null {
  if (!spells) {
    return null;
  }
  for (const s of spells) {
    if (s.inDate <= date && (s.outDate == null || date < s.outDate)) {
      return s.l1Name;
    }
  }
  return null;
}
