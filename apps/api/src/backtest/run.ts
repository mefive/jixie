import { prisma } from '../lib/prisma.js';
import { FACTORS } from '../factor/factors.js';
import * as st from './stats.js';

const PERIODS_PER_YEAR = 12; // monthly frequency
const N_BUCKETS = 10; // deciles
const MIN_HISTORY_DAYS = 365; // exclude recently-listed: listed / first bar at least 1 year old
const LIQUIDITY_DROP = 0.25; // drop the bottom 25% by turnover
const MIN_CANDIDATES = 100; // skip the month if too few usable stocks
const WINSOR_P = 0.01; // winsorize quantile for forward returns

export interface BucketStat {
  bucket: number; // 0=lowest factor value … 9=highest
  annReturn: number;
  sharpe: number;
  maxDrawdown: number;
  navEnd: number;
}

export interface FactorReport {
  factor: string;
  label: string;
  months: number;
  icMean: number;
  icStd: number;
  icir: number; // icMean / icStd (single period)
  icirAnnual: number; // icir × √12
  icPosRate: number; // fraction with IC>0
  buckets: BucketStat[];
  longShort: { annReturn: number; sharpe: number; maxDrawdown: number; navEnd: number };
  topTurnover: number; // average one-way turnover of the top bucket
}

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
    if (!next || cur.slice(0, 6) !== next.slice(0, 6)) out.push(cur);
  }
  return out;
}

function ymdMinusDays(ymd: string, days: number): string {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) - days * 86_400_000;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
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

export async function runBacktest(): Promise<FactorReport[]> {
  const rebalanceDates = await getRebalanceDates();
  const snaps = await loadSnapshots(rebalanceDates);

  // First-data date (proxy for excluding recently-listed stocks: earliest bar in the DB; old
  // stocks listed before 2015 count as 2015-01, which is old enough)
  const firstBarRows = await prisma.daily.groupBy({ by: ['tsCode'], _min: { tradeDate: true } });
  const firstBar = new Map(firstBarRows.map((r) => [r.tsCode, r._min.tradeDate ?? '99999999']));

  const reports: FactorReport[] = [];

  for (const fdef of FACTORS) {
    // Group factor values by rebalance day
    const fvRows = await prisma.factorValue.findMany({
      where: { factor: fdef.key },
      select: { tsCode: true, tradeDate: true, value: true },
    });
    const byDate = new Map<string, { tsCode: string; value: number }[]>();
    for (const r of fvRows) {
      if (!byDate.has(r.tradeDate)) byDate.set(r.tradeDate, []);
      byDate.get(r.tradeDate)!.push({ tsCode: r.tsCode, value: r.value });
    }

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

      const minFirst = ymdMinusDays(D, MIN_HISTORY_DAYS);

      // Candidates: has a factor value + has a quote that day + has a quote next period (so the
      // forward return is computable) + at least 1 year old
      let cands: { tsCode: string; value: number; amount: number; fwd: number }[] = [];
      for (const { tsCode, value } of fv) {
        const a = snapD.get(tsCode);
        const b = snapNext.get(tsCode);
        if (!a || !b) continue;
        if ((firstBar.get(tsCode) ?? '99999999') > minFirst) continue; // exclude recently-listed
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
      factor: fdef.key,
      label: fdef.label,
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
