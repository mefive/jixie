import type { BucketStat, FactorReport } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { FACTORS, FUNDAMENTAL_FACTORS, FACTOR_LABELS } from './factors.js';
import { sameMonth, minusDays } from '../lib/date.js';
import * as st from '../lib/stats.js';

// Wire shapes live in @jixie/shared (the /factors page renders them); re-export so existing
// imports of these types from this module keep working.
export type { BucketStat, FactorReport } from '@jixie/shared';

const PERIODS_PER_YEAR = 12; // monthly frequency
const N_BUCKETS = 10; // deciles
const MIN_HISTORY_DAYS = 365; // exclude recently-listed: listed / first bar at least 1 year old
const LIQUIDITY_DROP = 0.25; // drop the bottom 25% by turnover
const MIN_CANDIDATES = 100; // skip the month if too few usable stocks
const WINSOR_P = 0.01; // winsorize quantile for forward returns

// Month-end trading day (the last open day of each month) = rebalance day
async function getRebalanceDates(): Promise<string[]> {
  const cal = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1 },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const out: string[] = [];
  for (let i = 0; i < cal.length; i++) {
    const cur = cal[i].calDate;
    const next = cal[i + 1]?.calDate;
    // Last trading day of a month = the next trading day falls in a different month
    if (!next || !sameMonth(cur, next)) out.push(cur);
  }
  return out;
}

type Snap = Map<string, { adjClose: number; amount: number }>; // tsCode -> quote

/** Load a "backward-adjusted (hfq) close + turnover" snapshot for each rebalance day. */
async function loadSnapshots(dates: string[]): Promise<Map<string, Snap>> {
  const px = await prisma.daily.findMany({
    where: { tradeDate: { in: dates } },
    select: { tsCode: true, tradeDate: true, close: true, amount: true },
  });
  const adj = await prisma.adjFactor.findMany({
    where: { tradeDate: { in: dates } },
    select: { tsCode: true, tradeDate: true, adjFactor: true },
  });
  const adjMap = new Map(adj.map((a) => [`${a.tsCode}|${a.tradeDate}`, a.adjFactor]));
  const snaps = new Map<string, Snap>();
  for (const d of dates) snaps.set(d, new Map());
  for (const r of px) {
    if (r.close == null) continue;
    const f = adjMap.get(`${r.tsCode}|${r.tradeDate}`);
    if (f == null) continue; // skip the rare cases missing an adjustment factor at month-end
    snaps.get(r.tradeDate)!.set(r.tsCode, { adjClose: r.close * f, amount: r.amount ?? 0 });
  }
  return snaps;
}

// factor -> rebalance date -> [{ tsCode, value }]. The whole panel, held in memory for the run only.
type FactorPanel = Map<string, Map<string, { tsCode: string; value: number }[]>>;

/**
 * Compute every factor's value on each rebalance date, on the fly from raw tables (no FactorValue):
 *  - price-window factors (mom/rev/vol) from the per-stock hfq close series (same formulas as factors.ts),
 *  - fundamentals (ep/bp/dv/size) from daily_basic,
 *  - moneyflow (mf_net_main/total) from the Moneyflow table.
 * Values exist only in memory for this call; the caller persists the *report*, not the values.
 */
async function computeFactorPanel(rebalanceDates: string[]): Promise<FactorPanel> {
  const panel: FactorPanel = new Map();
  const rebalanceSet = new Set(rebalanceDates);
  const push = (factor: string, date: string, tsCode: string, value: number | null) => {
    if (value == null || !Number.isFinite(value)) return;
    let byDate = panel.get(factor);
    if (!byDate) panel.set(factor, (byDate = new Map()));
    let rows = byDate.get(date);
    if (!rows) byDate.set(date, (rows = []));
    rows.push({ tsCode, value });
  };

  // —— Price-window factors: per stock, build the hfq close series, compute at each rebalance index.
  const listDateMap = new Map(
    (await prisma.stockBasic.findMany({ select: { tsCode: true, listDate: true } })).map((s) => [
      s.tsCode,
      s.listDate,
    ]),
  );
  const stocks = await prisma.daily.findMany({ distinct: ['tsCode'], select: { tsCode: true } });
  for (const { tsCode } of stocks) {
    const [px, adj] = await Promise.all([
      prisma.daily.findMany({
        where: { tsCode },
        select: { tradeDate: true, close: true },
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
    const dates: string[] = [];
    const adjClose: number[] = [];
    let lastAdj: number | null = null; // carry forward last adj when missing, to avoid fake jumps
    for (const r of px) {
      if (r.close == null) continue;
      if (listDate && r.tradeDate < listDate) continue; // drop pre-IPO phantom bars
      const a = adjMap.get(r.tradeDate);
      if (a != null) lastAdj = a;
      if (lastAdj == null) continue;
      dates.push(r.tradeDate);
      adjClose.push(r.close * lastAdj);
    }
    for (let end = 0; end < dates.length; end++) {
      if (!rebalanceSet.has(dates[end])) continue;
      for (const f of FACTORS) push(f.key, dates[end], tsCode, f.fn(adjClose, dates, end));
    }
  }

  // —— Fundamentals: one query per rebalance date from daily_basic.
  for (const d of rebalanceDates) {
    const rows = await prisma.dailyBasic.findMany({
      where: { tradeDate: d },
      select: { tsCode: true, peTtm: true, pb: true, dvRatio: true, totalMv: true },
    });
    for (const r of rows) for (const f of FUNDAMENTAL_FACTORS) push(f.key, d, r.tsCode, f.from(r));
  }

  // —— Moneyflow: read the month-end rows from the Moneyflow table.
  const mf = await prisma.moneyflow.findMany({
    where: { tradeDate: { in: rebalanceDates } },
    select: { tsCode: true, tradeDate: true, netMain: true, netTotal: true },
  });
  for (const r of mf) {
    push('mf_net_main', r.tradeDate, r.tsCode, r.netMain);
    push('mf_net_total', r.tradeDate, r.tsCode, r.netTotal);
  }

  return panel;
}

export async function analyzeFactors(): Promise<FactorReport[]> {
  const rebalanceDates = await getRebalanceDates();
  const snaps = await loadSnapshots(rebalanceDates);
  const panel = await computeFactorPanel(rebalanceDates);

  // List date per stock, to exclude recently-listed (< MIN_HISTORY_DAYS old). Read from StockBasic
  // (a ~5k-row table) instead of a groupBy-min over the whole daily table (millions of rows).
  // Delisted stocks aren't in StockBasic → absent from the map → the lookup defaults them to very old
  // (kept), avoiding survivorship bias, same as the prior "earliest bar" proxy.
  const firstBar = new Map(
    (await prisma.stockBasic.findMany({ select: { tsCode: true, listDate: true } })).map((s) => [
      s.tsCode,
      s.listDate ?? '00000000',
    ]),
  );

  const reports: FactorReport[] = [];

  // Every factor we computed, in a stable order (price → fundamental → moneyflow).
  const factorKeys = [...panel.keys()].sort();

  for (const factorKey of factorKeys) {
    const byDate = panel.get(factorKey)!; // rebalance date -> [{ tsCode, value }]

    const icSeries: number[] = [];
    const bucketReturns: number[][] = Array.from({ length: N_BUCKETS }, () => []);
    const lsReturns: number[] = [];
    const turnovers: number[] = [];
    let prevTop: Set<string> | null = null;

    for (let m = 0; m < rebalanceDates.length - 1; m++) {
      const D = rebalanceDates[m];
      const Dnext = rebalanceDates[m + 1];
      const snapD = snaps.get(D);
      const snapNext = snaps.get(Dnext);
      const fv = byDate.get(D);
      if (!snapD || !snapNext || !fv) continue;

      const minFirst = minusDays(D, MIN_HISTORY_DAYS);

      // Candidates: has a factor value + has a quote that day + has a quote next period (so the
      // forward return is computable) + at least 1 year old
      let cands: { tsCode: string; value: number; amount: number; fwd: number }[] = [];
      for (const { tsCode, value } of fv) {
        const a = snapD.get(tsCode);
        const b = snapNext.get(tsCode);
        if (!a || !b) continue;
        if ((firstBar.get(tsCode) ?? '00000000') > minFirst) continue; // exclude recently-listed (absent=delisted→kept)
        cands.push({ tsCode, value, amount: a.amount, fwd: b.adjClose / a.adjClose - 1 });
      }
      if (cands.length < MIN_CANDIDATES) continue;

      // Liquidity: drop the bottom 25% by turnover
      cands.sort((x, y) => x.amount - y.amount);
      cands = cands.slice(Math.floor(cands.length * LIQUIDITY_DROP));

      const values = cands.map((c) => c.value);
      const fwdW = st.winsorize(
        cands.map((c) => c.fwd),
        WINSOR_P,
      );

      // Rank IC (factor value vs forward return, rank correlation)
      icSeries.push(st.spearman(values, fwdW));

      // Deciles
      const buckets = st.quantileBuckets(values, N_BUCKETS);
      const sum = new Array(N_BUCKETS).fill(0);
      const cnt = new Array(N_BUCKETS).fill(0);
      const top = new Set<string>();
      for (let i = 0; i < cands.length; i++) {
        sum[buckets[i]] += fwdW[i];
        cnt[buckets[i]]++;
        if (buckets[i] === N_BUCKETS - 1) top.add(cands[i].tsCode);
      }
      for (let b = 0; b < N_BUCKETS; b++) bucketReturns[b].push(cnt[b] ? sum[b] / cnt[b] : 0);
      lsReturns.push(sum[N_BUCKETS - 1] / cnt[N_BUCKETS - 1] - sum[0] / cnt[0]);

      // One-way turnover of the top bucket
      if (prevTop) {
        let changed = 0;
        for (const c of top) if (!prevTop.has(c)) changed++;
        turnovers.push(top.size ? changed / top.size : 0);
      }
      prevTop = top;
    }

    const icMean = st.mean(icSeries);
    const icStd = st.std(icSeries);
    const icir = icStd > 0 ? icMean / icStd : 0;

    const buckets: BucketStat[] = bucketReturns.map((rets, b) => ({
      bucket: b,
      annReturn: st.annualizedReturn(rets, PERIODS_PER_YEAR),
      sharpe: st.sharpe(rets, PERIODS_PER_YEAR),
      maxDrawdown: st.maxDrawdown(st.navFromReturns(rets)),
      navEnd: st.navFromReturns(rets).at(-1)!,
    }));

    reports.push({
      factor: factorKey,
      label: FACTOR_LABELS[factorKey] ?? factorKey,
      months: icSeries.length,
      icMean,
      icStd,
      icir,
      icirAnnual: icir * Math.sqrt(PERIODS_PER_YEAR),
      icPosRate: icSeries.filter((x) => x > 0).length / (icSeries.length || 1),
      buckets,
      longShort: {
        annReturn: st.annualizedReturn(lsReturns, PERIODS_PER_YEAR),
        sharpe: st.sharpe(lsReturns, PERIODS_PER_YEAR),
        maxDrawdown: st.maxDrawdown(st.navFromReturns(lsReturns)),
        navEnd: st.navFromReturns(lsReturns).at(-1)!,
      },
      topTurnover: st.mean(turnovers),
    });
  }

  return reports;
}
