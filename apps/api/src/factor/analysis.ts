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
const IC_DECAY_HORIZONS = [1, 5, 10, 20, 60]; // forward horizons (trading days) for the IC-decay curve

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
async function computeFactorSeries(
  factorKey: string,
  dates: string[],
  snaps: Map<string, Snap>,
  onLog: (msg: string) => void = () => {},
): Promise<Series> {
  const series: Series = new Map();
  const push = (date: string, tsCode: string, value: number | null) => {
    if (value == null || !Number.isFinite(value)) return;
    let rows = series.get(date);
    if (!rows) {
      rows = [];
      series.set(date, rows);
    }
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
    // Stock universe = tsCodes already found quoted on some rebalance date by loadSnapshots.
    // A stock absent from every snapshot can never survive the snapDate/snapNextDate lookup below
    // in analyzeFactor anyway, so there's no need to scan all of `daily` for every tsCode ever synced.
    const tsCodes = new Set<string>();
    for (const snap of snaps.values()) for (const tsCode of snap.keys()) tsCodes.add(tsCode);
    onLog(`逐股计算价格因子(${tsCodes.size} 只)…`);
    let done = 0;
    for (const tsCode of tsCodes) {
      if (++done % 800 === 0) onLog(`  已算 ${done}/${tsCodes.size} 只`);
      const [priceRows, adjRows] = await Promise.all([
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
      const adjMap = new Map(adjRows.map((a) => [a.tradeDate, a.adjFactor]));
      const listDate = listDateMap.get(tsCode);
      // Trade dates kept below, 1:1 aligned with adjClose by index (same filtering applied to both).
      const tradeDates: string[] = [];
      const adjClose: number[] = [];
      let lastAdj: number | null = null; // carry forward last adj when missing, to avoid fake jumps
      for (const r of priceRows) {
        if (r.close == null) continue;
        if (listDate && r.tradeDate < listDate) continue; // drop pre-IPO phantom bars
        const a = adjMap.get(r.tradeDate);
        if (a != null) lastAdj = a;
        if (lastAdj == null) continue;
        tradeDates.push(r.tradeDate);
        adjClose.push(r.close * lastAdj);
      }
      for (let end = 0; end < tradeDates.length; end++) {
        if (rebalanceSet.has(tradeDates[end])) {
          push(tradeDates[end], tsCode, priceFn(adjClose, tradeDates, end));
        }
      }
    }
  } else if (fundFn) {
    // Queried per-date (not batched with `in: dates`) — measured slower when batched here, likely
    // Prisma row-deserialization + SQLite IN-list planning overhead on top of the same total row count.
    for (const date of dates) {
      const rows = await prisma.dailyBasic.findMany({
        where: { tradeDate: date },
        select: { tsCode: true, peTtm: true, pb: true, dvRatio: true, totalMv: true },
      });
      for (const r of rows) push(date, r.tsCode, fundFn(r));
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
  onLog: (msg: string) => void = () => {},
): Promise<FactorReport> {
  const periodsPerYear = freq === 'week' ? 52 : 12;
  const rebalanceDates = await getRebalanceDates(freq, start, end);
  onLog(`调仓日 ${rebalanceDates.length} 个(${freq === 'week' ? '周' : '月'}度)· 加载行情快照…`);
  const snaps = await loadSnapshots(rebalanceDates);
  onLog(`计算因子 ${factorKey} 的值…`);
  const byDate = await computeFactorSeries(factorKey, rebalanceDates, snaps, onLog);

  // IC-decay: for each rebalance date D, the trading day D+h (h ∈ horizons) via the open-day calendar,
  // and a snapshot at those forward days — so we can measure Rank IC at multiple forward horizons.
  const calendar = (
    await prisma.tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1, calDate: { gte: start, lte: minusDays(end, -130) } },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    })
  ).map((r) => r.calDate);
  const calIndex = new Map(calendar.map((d, i) => [d, i]));
  // Subsample icDecay observations to ≤130 evenly-spaced rebalance dates — enough for a stable mean IC,
  // and it bounds the forward-snapshot load regardless of freq (weekly would otherwise load huge panels).
  const decayStep = Math.max(1, Math.ceil(rebalanceDates.length / 130));
  const decayDates = new Set(rebalanceDates.filter((_, i) => i % decayStep === 0));
  const forwardDates = new Set<string>();
  for (const d of decayDates) {
    const i = calIndex.get(d);
    if (i == null) continue;
    for (const h of IC_DECAY_HORIZONS) if (calendar[i + h]) forwardDates.add(calendar[i + h]);
  }
  onLog(`加载 IC 衰减前瞻快照(${forwardDates.size} 日)…`);
  const forwardSnaps = await loadSnapshots([...forwardDates]);
  const decaySeries: number[][] = IC_DECAY_HORIZONS.map(() => []);

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
    const date = rebalanceDates[m];
    const nextDate = rebalanceDates[m + 1];
    const snapDate = snaps.get(date);
    const snapNextDate = snaps.get(nextDate);
    const factorValues = byDate.get(date);
    if (!snapDate || !snapNextDate || !factorValues) continue;
    const minListDate = minusDays(date, MIN_HISTORY_DAYS);

    // Candidates: factor value + quote this period + quote next period (forward return) + ≥1yr old.
    let candidates: { tsCode: string; value: number; amount: number; fwd: number }[] = [];
    for (const { tsCode, value } of factorValues) {
      const a = snapDate.get(tsCode);
      const b = snapNextDate.get(tsCode);
      if (!a || !b) continue;
      if ((firstBar.get(tsCode) ?? '00000000') > minListDate) continue; // exclude recently-listed
      candidates.push({ tsCode, value, amount: a.amount, fwd: b.adjClose / a.adjClose - 1 });
    }
    if (candidates.length < MIN_CANDIDATES) continue;

    // Liquidity: drop the bottom fraction by turnover.
    candidates.sort((x, y) => x.amount - y.amount);
    candidates = candidates.slice(Math.floor(candidates.length * LIQUIDITY_DROP));

    const values = candidates.map((c) => c.value);
    const fwdW = st.winsorize(
      candidates.map((c) => c.fwd),
      WINSOR_P,
    );

    icSeries.push(st.spearman(values, fwdW)); // Rank IC (factor value vs forward return)

    // IC at each forward horizon (the decay curve) — same candidates, N-trading-day-forward return.
    // Only on the subsampled decay dates (bounds the forward-snapshot load; see decayDates above).
    if (decayDates.has(date)) {
      const iCal = calIndex.get(date)!;
      for (let hi = 0; hi < IC_DECAY_HORIZONS.length; hi++) {
        const forwardDate = calendar[iCal + IC_DECAY_HORIZONS[hi]];
        const snapForward = forwardDate ? forwardSnaps.get(forwardDate) : undefined;
        if (!snapForward) continue;
        const hVals: number[] = [];
        const hRets: number[] = [];
        for (const c of candidates) {
          const a = snapDate.get(c.tsCode);
          const b = snapForward.get(c.tsCode);
          if (!a || !b) continue;
          hVals.push(c.value);
          hRets.push(b.adjClose / a.adjClose - 1);
        }
        if (hVals.length >= MIN_CANDIDATES) {
          decaySeries[hi].push(st.spearman(hVals, st.winsorize(hRets, WINSOR_P)));
        }
      }
    }

    const buckets = st.quantileBuckets(values, N_BUCKETS);
    const bucketSums = new Array(N_BUCKETS).fill(0);
    const bucketCounts = new Array(N_BUCKETS).fill(0);
    const top = new Set<string>();
    for (let i = 0; i < candidates.length; i++) {
      bucketSums[buckets[i]] += fwdW[i];
      bucketCounts[buckets[i]]++;
      if (buckets[i] === N_BUCKETS - 1) top.add(candidates[i].tsCode);
    }
    for (let b = 0; b < N_BUCKETS; b++) {
      bucketReturns[b].push(bucketCounts[b] ? bucketSums[b] / bucketCounts[b] : 0);
    }
    lsReturns.push(
      bucketSums[N_BUCKETS - 1] / bucketCounts[N_BUCKETS - 1] - bucketSums[0] / bucketCounts[0],
    );

    if (prevTop) {
      let changed = 0;
      for (const c of top) if (!prevTop.has(c)) changed++;
      turnovers.push(top.size ? changed / top.size : 0);
    }
    prevTop = top;
  }

  onLog('汇总 IC / 分层 / IC 衰减…');
  const icMean = st.mean(icSeries);
  const icStd = st.std(icSeries);
  const icir = icStd > 0 ? icMean / icStd : 0;

  const icDecay = IC_DECAY_HORIZONS.map((horizonDays, hi) => {
    const series = decaySeries[hi];
    const mean = st.mean(series);
    const sd = st.std(series);
    return { horizonDays, icMean: mean, icir: sd > 0 ? mean / sd : 0 };
  });

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
    icDecay,
  };
}
