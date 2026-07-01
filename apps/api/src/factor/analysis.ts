import type { BucketStat, FactorReport, FactorFreq } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { FACTORS, FUNDAMENTAL_FACTORS, FACTOR_LABELS } from './factors.js';
import { sameMonth, sameWeek, minusDays } from '../lib/date.js';
import * as st from '../lib/stats.js';

// Wire shapes live in @jixie/shared (the /factors page renders them); re-export for local imports.
export type { BucketStat, FactorReport } from '@jixie/shared';

const N_BUCKETS = 10; // deciles
const MIN_HISTORY_DAYS = 365; // exclude recently-listed: listed at least 1 year ago
const LIQUIDITY_DROP = 0.25; // drop the bottom 25% by turnover
const MIN_CANDIDATES = 100; // skip the period if too few usable stocks
const WINSOR_P = 0.01; // winsorize quantile for forward returns

// Rebalance days within [start,end]: the last open day of each month (or ISO week).
async function getRebalanceDates(freq: FactorFreq, start: string, end: string): Promise<string[]> {
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
    if (!next || !same(cur, next)) out.push(cur);
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
    if (f == null) continue; // skip the rare cases missing an adjustment factor
    snaps.get(r.tradeDate)!.set(r.tsCode, { adjClose: r.close * f, amount: r.amount ?? 0 });
  }
  return snaps;
}

type Series = Map<string, { tsCode: string; value: number }[]>; // rebalance date -> [{tsCode, value}]

/**
 * Compute ONE factor's value on each rebalance date, on the fly. Dispatch by kind:
 *  - price (mom/rev/vol): per-stock hfq close series → the factor formula at each rebalance index,
 *  - fundamental (ep/bp/dv/size): read daily_basic per rebalance date,
 *  - moneyflow (mf_net_main/total): read the Moneyflow table.
 * A non-price factor skips the (expensive) per-stock price loop entirely — the big single-factor win.
 */
async function computeFactorSeries(factorKey: string, dates: string[]): Promise<Series> {
  const series: Series = new Map();
  const push = (date: string, tsCode: string, value: number | null) => {
    if (value == null || !Number.isFinite(value)) return;
    let rows = series.get(date);
    if (!rows) series.set(date, (rows = []));
    rows.push({ tsCode, value });
  };

  const priceFn = FACTORS.find((f) => f.key === factorKey)?.fn;
  const fundFn = FUNDAMENTAL_FACTORS.find((f) => f.key === factorKey)?.from;

  if (priceFn) {
    const rebalanceSet = new Set(dates);
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
      const ds: string[] = [];
      const adjClose: number[] = [];
      let lastAdj: number | null = null; // carry forward last adj when missing, to avoid fake jumps
      for (const r of px) {
        if (r.close == null) continue;
        if (listDate && r.tradeDate < listDate) continue; // drop pre-IPO phantom bars
        const a = adjMap.get(r.tradeDate);
        if (a != null) lastAdj = a;
        if (lastAdj == null) continue;
        ds.push(r.tradeDate);
        adjClose.push(r.close * lastAdj);
      }
      for (let end = 0; end < ds.length; end++) {
        if (rebalanceSet.has(ds[end])) push(ds[end], tsCode, priceFn(adjClose, ds, end));
      }
    }
  } else if (fundFn) {
    for (const d of dates) {
      const rows = await prisma.dailyBasic.findMany({
        where: { tradeDate: d },
        select: { tsCode: true, peTtm: true, pb: true, dvRatio: true, totalMv: true },
      });
      for (const r of rows) push(d, r.tsCode, fundFn(r));
    }
  } else if (factorKey === 'mf_net_main' || factorKey === 'mf_net_total') {
    const mf = await prisma.moneyflow.findMany({
      where: { tradeDate: { in: dates } },
      select: { tsCode: true, tradeDate: true, netMain: true, netTotal: true },
    });
    for (const r of mf) {
      push(r.tradeDate, r.tsCode, factorKey === 'mf_net_main' ? r.netMain : r.netTotal);
    }
  }

  return series;
}

/**
 * Analyze one factor over a (freq, start, end) window: monthly/weekly cross-sectional deciles + Rank IC
 * + long-short. Values are computed on the fly and held only for this call — the caller persists the
 * returned report, not the values.
 */
export async function analyzeFactor(
  factorKey: string,
  freq: FactorFreq,
  start: string,
  end: string,
): Promise<FactorReport> {
  const periodsPerYear = freq === 'week' ? 52 : 12;
  const rebalanceDates = await getRebalanceDates(freq, start, end);
  const snaps = await loadSnapshots(rebalanceDates);
  const byDate = await computeFactorSeries(factorKey, rebalanceDates);

  // List date per stock, to exclude recently-listed (< MIN_HISTORY_DAYS). Absent (delisted) → kept.
  const firstBar = new Map(
    (await prisma.stockBasic.findMany({ select: { tsCode: true, listDate: true } })).map((s) => [
      s.tsCode,
      s.listDate ?? '00000000',
    ]),
  );

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

    // Candidates: factor value + quote this period + quote next period (forward return) + ≥1yr old.
    let cands: { tsCode: string; value: number; amount: number; fwd: number }[] = [];
    for (const { tsCode, value } of fv) {
      const a = snapD.get(tsCode);
      const b = snapNext.get(tsCode);
      if (!a || !b) continue;
      if ((firstBar.get(tsCode) ?? '00000000') > minFirst) continue; // exclude recently-listed
      cands.push({ tsCode, value, amount: a.amount, fwd: b.adjClose / a.adjClose - 1 });
    }
    if (cands.length < MIN_CANDIDATES) continue;

    // Liquidity: drop the bottom fraction by turnover.
    cands.sort((x, y) => x.amount - y.amount);
    cands = cands.slice(Math.floor(cands.length * LIQUIDITY_DROP));

    const values = cands.map((c) => c.value);
    const fwdW = st.winsorize(
      cands.map((c) => c.fwd),
      WINSOR_P,
    );

    icSeries.push(st.spearman(values, fwdW)); // Rank IC (factor value vs forward return)

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
    annReturn: st.annualizedReturn(rets, periodsPerYear),
    sharpe: st.sharpe(rets, periodsPerYear),
    maxDrawdown: st.maxDrawdown(st.navFromReturns(rets)),
    navEnd: st.navFromReturns(rets).at(-1)!,
  }));

  return {
    factor: factorKey,
    label: FACTOR_LABELS[factorKey] ?? factorKey,
    freq,
    start,
    end,
    periods: icSeries.length,
    icMean,
    icStd,
    icir,
    icirAnnual: icir * Math.sqrt(periodsPerYear),
    icPosRate: icSeries.filter((x) => x > 0).length / (icSeries.length || 1),
    buckets,
    longShort: {
      annReturn: st.annualizedReturn(lsReturns, periodsPerYear),
      sharpe: st.sharpe(lsReturns, periodsPerYear),
      maxDrawdown: st.maxDrawdown(st.navFromReturns(lsReturns)),
      navEnd: st.navFromReturns(lsReturns).at(-1)!,
    },
    topTurnover: st.mean(turnovers),
  };
}
