import type { BucketStat, FactorBar, FactorReport, FactorFreq } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { compileFactor } from './compile-factor.js';
import type { FactorCtx } from './factor-sdk.js';
import type { UserLogSink } from '../lib/sandbox-console.js';
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
    if (!next || !same(cur, next)) {
      out.push(cur);
    }
  }
  return out;
}

type Snap = Map<string, { adjClose: number; amount: number; mktcap: number }>; // tsCode -> quote

/** Load a "hfq close + turnover (+ 总市值 for cap-weighting)" snapshot for each day. `withMktcap` only
 * for rebalance (formation) dates — forward snapshots weight by the formation-date cap, so they skip it. */
async function loadSnapshots(dates: string[], withMktcap = false): Promise<Map<string, Snap>> {
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

type Series = Map<string, { tsCode: string; value: number }[]>; // rebalance date -> [{tsCode, value}]

/** ctx for factors that declared no window — using ctx.history is an authoring error, said loudly. */
const NO_HISTORY_CTX = {
  history(): never {
    throw new Error('要用 ctx.history 需在 defineFactor 里声明 window(所需交易日数,含当天)');
  },
} as unknown as FactorCtx;

/** ctx over one stock's aligned hfq-close/date arrays, ending (inclusive) at index `end`. */
function makeWindowCtx(adjClose: number[], tradeDates: string[], end: number): FactorCtx {
  return {
    history(n: number, field?: 'date') {
      const from = end - n + 1;
      if (n <= 0 || from < 0) {
        return [];
      }
      return field === 'date' ? tradeDates.slice(from, end + 1) : adjClose.slice(from, end + 1);
    },
  } as FactorCtx;
}

/**
 * Compute ONE factor's value on each rebalance date, on the fly. Presets and user factors share this
 * single path (factor-to-strategy.md Step 1b): load the Factor row's code (preset rows are seeded
 * from builtin-factors.ts), compile, run compute cross-sectionally. Two speeds by declaration:
 *  - no `window`: per rebalance date over the FactorBar cross-section (daily_basic + moneyflow),
 *  - `window: n`: additionally walks each stock's hfq close series so ctx.history works (the
 *    expensive per-stock loop — declared, never implicitly detected).
 * A throwing / null compute drops that stock for the period.
 */
async function computeFactorSeries(
  factorKey: string,
  dates: string[],
  snaps: Map<string, Snap>,
  onLog: (msg: string) => void = () => {},
  onUserLog?: UserLogSink,
): Promise<Series> {
  const series: Series = new Map();
  const push = (date: string, tsCode: string, value: number | null) => {
    if (value == null || !Number.isFinite(value)) {
      return;
    }
    let rows = series.get(date);
    if (!rows) {
      rows = [];
      series.set(date, rows);
    }
    rows.push({ tsCode, value });
  };

  const row = await prisma.factor.findUnique({ where: { id: factorKey }, select: { code: true } });
  if (!row) {
    onLog(`⚠️ 因子 ${factorKey} 不存在(预置未 seed 或已被删除)`);
    return series;
  }
  const factor = await compileFactor(row.code, onUserLog);

  // The first compute error is surfaced once (per-stock errors just drop the stock — a factor that
  // throws everywhere would otherwise produce a silently-empty report).
  let firstComputeError: string | null = null;
  const runCompute = (bar: FactorBar, ctx: FactorCtx): number | null => {
    try {
      return factor.compute(bar, ctx);
    } catch (e) {
      firstComputeError ??= e instanceof Error ? e.message : String(e);
      return null;
    }
  };

  // One date's FactorBar cross-section: daily_basic valuation + moneyflow (flow semantics — exact
  // date, absent = null, never carried forward). Queried per-date (not batched with `in: dates`) —
  // measured slower when batched, likely Prisma row-deserialization + IN-list planning overhead.
  const loadBars = async (date: string): Promise<Map<string, FactorBar>> => {
    const [basicRows, flowRows] = await Promise.all([
      prisma.dailyBasic.findMany({
        where: { tradeDate: date },
        select: {
          tsCode: true,
          pe: true,
          peTtm: true,
          pb: true,
          ps: true,
          psTtm: true,
          dvRatio: true,
          dvTtm: true,
          totalMv: true,
          circMv: true,
          turnoverRate: true,
        },
      }),
      prisma.moneyflow.findMany({
        where: { tradeDate: date },
        select: { tsCode: true, netMain: true, netTotal: true },
      }),
    ]);

    const bars = new Map<string, FactorBar>();
    for (const r of basicRows) {
      bars.set(r.tsCode, {
        code: r.tsCode,
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
        netMain: null,
        netTotal: null,
      });
    }
    for (const flow of flowRows) {
      const bar = bars.get(flow.tsCode);
      if (bar) {
        bar.netMain = flow.netMain;
        bar.netTotal = flow.netTotal;
      } else {
        // Flow data but no daily_basic row that day — still a valid cross-section member.
        bars.set(flow.tsCode, {
          ...EMPTY_BAR,
          code: flow.tsCode,
          netMain: flow.netMain,
          netTotal: flow.netTotal,
        });
      }
    }
    return bars;
  };

  if (!factor.window) {
    // Fast path: pure cross-section, no price history.
    onLog('逐日横截面计算…');
    for (const date of dates) {
      const bars = await loadBars(date);
      for (const bar of bars.values()) {
        push(date, bar.code, runCompute(bar, NO_HISTORY_CTX));
      }
    }
  } else {
    const rebalanceSet = new Set(dates);
    onLog(`加载估值/资金流截面(${dates.length} 日)…`);
    const barsByDate = new Map<string, Map<string, FactorBar>>();
    for (const date of dates) {
      barsByDate.set(date, await loadBars(date));
    }

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
    for (const snap of snaps.values()) {
      for (const tsCode of snap.keys()) {
        tsCodes.add(tsCode);
      }
    }
    onLog(`逐股计算窗口因子(window=${factor.window},${tsCodes.size} 只)…`);
    let done = 0;
    for (const tsCode of tsCodes) {
      if (++done % 800 === 0) {
        onLog(`  已算 ${done}/${tsCodes.size} 只`);
      }
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
        if (r.close == null) {
          continue;
        }
        if (listDate && r.tradeDate < listDate) {
          continue;
        } // drop pre-IPO phantom bars
        const a = adjMap.get(r.tradeDate);
        if (a != null) {
          lastAdj = a;
        }
        if (lastAdj == null) {
          continue;
        }
        tradeDates.push(r.tradeDate);
        adjClose.push(r.close * lastAdj);
      }
      for (let end = 0; end < tradeDates.length; end++) {
        if (!rebalanceSet.has(tradeDates[end])) {
          continue;
        }
        const date = tradeDates[end];
        const bar = barsByDate.get(date)?.get(tsCode) ?? { ...EMPTY_BAR, code: tsCode };
        push(date, tsCode, runCompute(bar, makeWindowCtx(adjClose, tradeDates, end)));
      }
    }
  }

  if (firstComputeError) {
    onLog(`⚠️ 因子 compute 有抛错(相应股票已剔除),首个错误:${firstComputeError}`);
  }
  return series;
}

/** All-null bar for stocks missing daily_basic that day (only code + moneyflow known). */
const EMPTY_BAR: FactorBar = {
  code: '',
  pe: null,
  peTtm: null,
  pb: null,
  ps: null,
  psTtm: null,
  dvRatio: null,
  dvTtm: null,
  totalMv: null,
  circMv: null,
  turnoverRate: null,
  netMain: null,
  netTotal: null,
};

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
  onUserLog?: UserLogSink,
): Promise<FactorReport> {
  const periodsPerYear = freq === 'week' ? 52 : 12;
  const rebalanceDates = await getRebalanceDates(freq, start, end);
  onLog(`调仓日 ${rebalanceDates.length} 个(${freq === 'week' ? '周' : '月'}度)· 加载行情快照…`);
  const snaps = await loadSnapshots(rebalanceDates, true); // rebalance snaps carry 总市值 for cap-weighting
  onLog(`计算因子 ${factorKey} 的值…`);
  const byDate = await computeFactorSeries(factorKey, rebalanceDates, snaps, onLog, onUserLog);

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
    if (i == null) {
      continue;
    }
    for (const h of IC_DECAY_HORIZONS) {
      if (calendar[i + h]) {
        forwardDates.add(calendar[i + h]);
      }
    }
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
  const bucketReturns: number[][] = Array.from({ length: N_BUCKETS }, () => []); // 等权
  const bucketReturnsMktcap: number[][] = Array.from({ length: N_BUCKETS }, () => []); // 市值加权
  const lsReturns: number[] = [];
  const lsReturnsMktcap: number[] = [];
  const turnovers: number[] = [];
  // 分位 × 前瞻期(日度归一化):qh[hi][bucket] = 各调仓日该分位的日均前瞻收益列表 → 末尾取均值
  const qhEqual = IC_DECAY_HORIZONS.map(() =>
    Array.from({ length: N_BUCKETS }, () => [] as number[]),
  );
  const qhMktcap = IC_DECAY_HORIZONS.map(() =>
    Array.from({ length: N_BUCKETS }, () => [] as number[]),
  );
  let prevTop: Set<string> | null = null;

  for (let m = 0; m < rebalanceDates.length - 1; m++) {
    const date = rebalanceDates[m];
    const nextDate = rebalanceDates[m + 1];
    const snapDate = snaps.get(date);
    const snapNextDate = snaps.get(nextDate);
    const factorValues = byDate.get(date);
    if (!snapDate || !snapNextDate || !factorValues) {
      continue;
    }
    const minListDate = minusDays(date, MIN_HISTORY_DAYS);

    // Candidates: factor value + quote this period + quote next period (forward return) + ≥1yr old.
    let candidates: {
      tsCode: string;
      value: number;
      amount: number;
      mktcap: number;
      fwd: number;
    }[] = [];
    for (const { tsCode, value } of factorValues) {
      const a = snapDate.get(tsCode);
      const b = snapNextDate.get(tsCode);
      if (!a || !b) {
        continue;
      }
      if ((firstBar.get(tsCode) ?? '00000000') > minListDate) {
        continue;
      } // exclude recently-listed
      candidates.push({
        tsCode,
        value,
        amount: a.amount,
        mktcap: a.mktcap,
        fwd: b.adjClose / a.adjClose - 1,
      });
    }
    if (candidates.length < MIN_CANDIDATES) {
      continue;
    }

    // Liquidity: drop the bottom fraction by turnover.
    candidates.sort((x, y) => x.amount - y.amount);
    candidates = candidates.slice(Math.floor(candidates.length * LIQUIDITY_DROP));

    const values = candidates.map((c) => c.value);
    const fwdW = st.winsorize(
      candidates.map((c) => c.fwd),
      WINSOR_P,
    );

    icSeries.push(st.spearman(values, fwdW)); // Rank IC (factor value vs forward return)

    const buckets = st.quantileBuckets(values, N_BUCKETS); // decile index per candidate

    // Main decile forward returns (next period): equal-weight + cap-weight, plus the top-decile set.
    const perBucket: { v: number; w: number }[][] = Array.from({ length: N_BUCKETS }, () => []);
    const top = new Set<string>();
    for (let i = 0; i < candidates.length; i++) {
      perBucket[buckets[i]].push({ v: fwdW[i], w: candidates[i].mktcap });
      if (buckets[i] === N_BUCKETS - 1) {
        top.add(candidates[i].tsCode);
      }
    }
    for (let b = 0; b < N_BUCKETS; b++) {
      bucketReturns[b].push(equalMean(perBucket[b]));
      bucketReturnsMktcap[b].push(capMean(perBucket[b]));
    }
    lsReturns.push(equalMean(perBucket[N_BUCKETS - 1]) - equalMean(perBucket[0]));
    lsReturnsMktcap.push(capMean(perBucket[N_BUCKETS - 1]) - capMean(perBucket[0]));

    // IC-decay + per-decile return at each forward horizon (daily-normalized so horizons compare).
    // Only on the subsampled decay dates (bounds the forward-snapshot load; see decayDates above).
    if (decayDates.has(date)) {
      const iCal = calIndex.get(date)!;
      for (let hi = 0; hi < IC_DECAY_HORIZONS.length; hi++) {
        const h = IC_DECAY_HORIZONS[hi];
        const forwardDate = calendar[iCal + h];
        const snapForward = forwardDate ? forwardSnaps.get(forwardDate) : undefined;
        if (!snapForward) {
          continue;
        }
        const hVals: number[] = [];
        const hRets: number[] = [];
        const hb: { v: number; w: number }[][] = Array.from({ length: N_BUCKETS }, () => []);
        for (let i = 0; i < candidates.length; i++) {
          const a = snapDate.get(candidates[i].tsCode);
          const b = snapForward.get(candidates[i].tsCode);
          if (!a || !b) {
            continue;
          }
          const ret = b.adjClose / a.adjClose - 1;
          hVals.push(candidates[i].value);
          hRets.push(ret);
          hb[buckets[i]].push({ v: Math.pow(1 + ret, 1 / h) - 1, w: candidates[i].mktcap }); // 日度归一化
        }
        if (hVals.length >= MIN_CANDIDATES) {
          decaySeries[hi].push(st.spearman(hVals, st.winsorize(hRets, WINSOR_P)));
          for (let b = 0; b < N_BUCKETS; b++) {
            if (hb[b].length) {
              qhEqual[hi][b].push(equalMean(hb[b]));
              qhMktcap[hi][b].push(capMean(hb[b]));
            }
          }
        }
      }
    }

    if (prevTop) {
      let changed = 0;
      for (const c of top) {
        if (!prevTop.has(c)) {
          changed++;
        }
      }
      turnovers.push(top.size ? changed / top.size : 0);
    }
    prevTop = top;
  }

  onLog('汇总 IC / 分层 / IC 衰减…');
  // Preset and custom factors both label from their Factor row (presets are seeded code rows).
  const label =
    (await prisma.factor.findUnique({ where: { id: factorKey }, select: { name: true } }))?.name ??
    factorKey;
  const icMean = st.mean(icSeries);
  const icStd = st.std(icSeries);
  const icir = icStd > 0 ? icMean / icStd : 0;

  const icDecay = IC_DECAY_HORIZONS.map((horizonDays, hi) => {
    const series = decaySeries[hi];
    const mean = st.mean(series);
    const sd = st.std(series);
    return { horizonDays, icMean: mean, icir: sd > 0 ? mean / sd : 0 };
  });

  const toBuckets = (rows: number[][]): BucketStat[] =>
    rows.map((rets, b) => ({
      bucket: b,
      annReturn: st.annualizedReturn(rets, periodsPerYear),
      sharpe: st.sharpe(rets, periodsPerYear),
      maxDrawdown: st.maxDrawdown(st.navFromReturns(rets)),
      navEnd: st.navFromReturns(rets).at(-1)!,
    }));
  const toLongShort = (rets: number[]): FactorReport['longShort'] => ({
    annReturn: st.annualizedReturn(rets, periodsPerYear),
    sharpe: st.sharpe(rets, periodsPerYear),
    maxDrawdown: st.maxDrawdown(st.navFromReturns(rets)),
    navEnd: st.navFromReturns(rets).at(-1)!,
  });
  const buckets = toBuckets(bucketReturns);
  const quantileHorizons = IC_DECAY_HORIZONS.map((horizonDays, hi) => ({
    horizonDays,
    equal: qhEqual[hi].map((list) => st.mean(list)),
    mktcap: qhMktcap[hi].map((list) => st.mean(list)),
  }));

  return {
    factor: factorKey,
    label,
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
    longShort: toLongShort(lsReturns),
    topTurnover: st.mean(turnovers),
    icDecay,
    bucketsMktcap: toBuckets(bucketReturnsMktcap),
    longShortMktcap: toLongShort(lsReturnsMktcap),
    quantileHorizons,
  };
}

// —— weighting helpers ——

/** Equal-weight mean of a bucket's values. */
function equalMean(items: { v: number }[]): number {
  return items.length ? items.reduce((s, x) => s + x.v, 0) / items.length : 0;
}

/** Cap-weight mean: Σ(v·w) / Σw (w = 总市值); 0 if the bucket has no positive-cap names. */
function capMean(items: { v: number; w: number }[]): number {
  let sumW = 0;
  let sumVW = 0;
  for (const x of items) {
    sumW += x.w;
    sumVW += x.v * x.w;
  }
  return sumW > 0 ? sumVW / sumW : 0;
}
