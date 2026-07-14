import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';
import type { BucketStat, FactorBar, FactorReport, FactorFreq, Neutral } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { compileFactor, type FactorBatchItem } from './compile-factor.js';
import type { UserLogSink } from '../lib/sandbox-console.js';
import { sameMonth, sameWeek, minusDays } from '../lib/date.js';
import { t } from '../i18n/messages.js';
import * as st from '../lib/stats.js';

// Wire shapes live in @jixie/shared (the /factors page renders them); re-export for local imports.
export type { BucketStat, FactorReport } from '@jixie/shared';

const N_BUCKETS = 10; // deciles
const MIN_HISTORY_DAYS = 365; // exclude recently-listed: listed at least 1 year ago
const LIQUIDITY_DROP = 0.25; // drop the bottom 25% by turnover
const MIN_CANDIDATES = 100; // skip the period if too few usable stocks
const WINSOR_P = 0.01; // winsorize quantile for forward returns
const IC_DECAY_HORIZONS = [1, 5, 10, 20, 60]; // forward horizons (trading days) for the IC-decay curve

// Net-of-cost view (3.4): per-side trading cost estimates for the hypothetical long-short. A round-trip
// (churning one name) = buy side + sell side ≈ 30bps — the first tradability gate for high-turnover
// factors (short-reversal / money-flow) whose paper IC looks good but decays after costs.
const COMMISSION_BPS = 0.00025; // brokerage, per side (A-share ~万2.5)
const STAMP_BPS = 0.0005; // stamp duty, SELL side only (千0.5)
const SLIPPAGE_BPS = 0.001; // assumed slippage/impact, per side
const BUY_COST = COMMISSION_BPS + SLIPPAGE_BPS; // establishing/adding a long name
const SELL_COST = COMMISSION_BPS + STAMP_BPS + SLIPPAGE_BPS; // exiting a name
const ROUND_TRIP_COST = BUY_COST + SELL_COST; // churning a name (sell the leaver + buy the joiner) ≈ 0.0030

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

export type Series = Map<string, { tsCode: string; value: number }[]>; // rebalance date -> [{tsCode, value}]

// One financial report's as-of fundamentals + the announcement date that gates them (PIT).
type FinaReport = {
  annDate: string;
  roe: number | null;
  grossprofitMargin: number | null;
  debtToAssets: number | null;
};
type FinaIndex = Map<string, FinaReport[]>; // code -> reports ascending by annDate

/** Load all financial reports once, grouped by code ascending by annDate — the point-in-time source for
 * the FactorBar fundamentals (roe / gross margin / debt ratio). Rows without an annDate are skipped (they
 * can't be PIT-gated). Mirrors EngineData.ensureFina so the factor and backtest sides read fina the same way. */
async function loadFinaIndex(): Promise<FinaIndex> {
  const rows = await prisma.finaIndicator.findMany({
    where: { annDate: { not: null } },
    select: { tsCode: true, annDate: true, roe: true, grossprofitMargin: true, debtToAssets: true },
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
      grossprofitMargin: r.grossprofitMargin,
      debtToAssets: r.debtToAssets,
    });
  }
  return index;
}

/** The latest report public as-of `date` for `code` (largest annDate ≤ date), or null — binary search
 * over the ascending list. Same PIT rule as EngineData.roeAsOf: no report visible before its annDate. */
function finaAsOf(index: FinaIndex, code: string, date: string): FinaReport | null {
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

/**
 * Compute ONE factor's value on each rebalance date, on the fly. Presets and user factors share this
 * single path (factor-to-strategy.md Step 1b): load the Factor row's code (preset rows are seeded
 * from builtin-factors.ts), compile into an isolated-vm sandbox, run compute cross-sectionally.
 * Two speeds by declaration:
 *  - no `window`: per rebalance date over the FactorBar cross-section (daily_basic + moneyflow),
 *    ONE wall-crossing per date;
 *  - `window: n`: additionally walks each stock's hfq close series so ctx.history works (the
 *    expensive per-stock loop — declared, never implicitly detected), ONE crossing per stock.
 * A throwing / null / non-finite compute drops that stock for the period (errors surface once via
 * the log sink, prefixed [factor-error]).
 */
export async function computeFactorSeries(
  factorKey: string,
  dates: string[],
  snaps: Map<string, Snap>,
  onLog: (msg: string) => void = () => {},
  onUserLog?: UserLogSink,
  locale: Locale = DEFAULT_LOCALE,
  factorCodeSnapshot?: string,
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

  const currentFactor = factorCodeSnapshot
    ? null
    : await prisma.factor.findUnique({ where: { id: factorKey }, select: { code: true } });
  const factorCode = factorCodeSnapshot ?? currentFactor?.code;
  if (!factorCode) {
    onLog(t(locale, 'factorMissing', { factor: factorKey }));
    return series;
  }
  // The first compute error is surfaced once at the end (per-stock errors just drop the stock — a
  // factor that throws everywhere would otherwise produce a silently-empty report). Errors arrive
  // through the sandbox log drain, prefixed [factor-error].
  let firstComputeError: string | null = null;
  const logSink: UserLogSink = (level, line) => {
    if (line.startsWith('[factor-error]')) {
      firstComputeError ??= line;
    }
    onUserLog?.(level, line);
  };
  const factor = await compileFactor(factorCode, logSink);
  const needsTurnoverRateFHistory = factorCode.includes("'turnoverRateF'");

  // Preload all financial reports once (PIT-gated by annDate); loadBars picks each stock's as-of report.
  const finaIndex = await loadFinaIndex();

  // One date's FactorBar cross-section: daily_basic valuation + moneyflow (flow semantics — exact
  // date, absent = null, never carried forward) + as-of fundamentals (latest annDate ≤ date). Queried
  // per-date (not batched with `in: dates`) — measured slower when batched, likely Prisma row-
  // deserialization + IN-list planning overhead.
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
        roe: null,
        grossprofitMargin: null,
        debtToAssets: null,
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
    // As-of fundamentals: the latest report public on/before this date (no look-ahead).
    for (const [code, bar] of bars) {
      const fina = finaAsOf(finaIndex, code, date);
      if (fina) {
        bar.roe = fina.roe;
        bar.grossprofitMargin = fina.grossprofitMargin;
        bar.debtToAssets = fina.debtToAssets;
      }
    }
    return bars;
  };

  try {
    if (!factor.window) {
      // Fast path: pure cross-section, no price history — one wall-crossing per date.
      onLog(t(locale, 'factorDailyCrossSection'));
      for (const date of dates) {
        const bars = [...(await loadBars(date)).values()];
        const values = await factor.computeBatch(bars.map((bar) => ({ bar })));
        for (let i = 0; i < bars.length; i++) {
          push(date, bars[i].code, values[i]);
        }
      }
      return series;
    }
    const rebalanceSet = new Set(dates);
    onLog(t(locale, 'factorLoadingSections', { count: dates.length }));
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
    onLog(t(locale, 'factorPerStockWindow', { window: factor.window, count: tsCodes.size }));
    let done = 0;
    for (const tsCode of tsCodes) {
      if (++done % 800 === 0) {
        onLog(t(locale, 'factorComputeProgress', { done, total: tsCodes.size }));
      }
      const [priceRows, adjRows, basicRows] = await Promise.all([
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
        needsTurnoverRateFHistory
          ? prisma.dailyBasic.findMany({
              where: { tsCode },
              select: { tradeDate: true, turnoverRateF: true },
              orderBy: { tradeDate: 'asc' },
            })
          : Promise.resolve([]),
      ]);
      const adjMap = new Map(adjRows.map((a) => [a.tradeDate, a.adjFactor]));
      const turnoverRateFMap = new Map(
        basicRows.map((basic) => [basic.tradeDate, basic.turnoverRateF]),
      );
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
      // One wall-crossing per stock: every rebalance index becomes a batch item carrying the
      // bar + the hfq close/date window ENDING at that day (ctx.history slices tails in-wall).
      const items: FactorBatchItem[] = [];
      const itemDates: string[] = [];
      const window = factor.window;
      for (let end = 0; end < tradeDates.length; end++) {
        if (!rebalanceSet.has(tradeDates[end])) {
          continue;
        }
        const date = tradeDates[end];
        const from = Math.max(0, end - window + 1);
        items.push({
          bar: barsByDate.get(date)?.get(tsCode) ?? { ...EMPTY_BAR, code: tsCode },
          closes: adjClose.slice(from, end + 1),
          dates: tradeDates.slice(from, end + 1),
          turnoverRatesF: tradeDates
            .slice(from, end + 1)
            .map((tradeDate) => turnoverRateFMap.get(tradeDate) ?? null),
        });
        itemDates.push(date);
      }
      if (items.length) {
        const values = await factor.computeBatch(items);
        for (let i = 0; i < items.length; i++) {
          push(itemDates[i], tsCode, values[i]);
        }
      }
    }
  } finally {
    if (firstComputeError) {
      onLog(t(locale, 'factorComputeErrors', { error: firstComputeError }));
    }
    factor.dispose();
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
  roe: null,
  grossprofitMargin: null,
  debtToAssets: null,
};

// —— cross-sectional neutralization (3.4) ——

const NEUTRAL_MIN_GROUP = 5; // industries smaller than this are merged into the largest one before demeaning

type IndustrySpell = { inDate: string; outDate: string | null; l1Name: string };

/** Load Shenwan level-1 membership once and index it by stock, spells ascending by inDate — the
 * point-in-time (stock → industry) lookup for industry-neutralization. */
async function loadIndustryLookup(): Promise<Map<string, IndustrySpell[]>> {
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
function industryOn(spells: IndustrySpell[] | undefined, date: string): string | null {
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

/** Relabel members of any group smaller than NEUTRAL_MIN_GROUP into the largest group, so a handful of
 * lone-industry stocks don't each form their own (degenerate, residual-zero) demeaning bucket. */
function mergeSmallGroups(groups: string[]): string[] {
  const counts = new Map<string, number>();
  for (const g of groups) {
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let largest = groups[0];
  for (const [key, count] of counts) {
    if (count > (counts.get(largest) ?? 0)) {
      largest = key;
    }
  }
  return groups.map((g) => ((counts.get(g) ?? 0) < NEUTRAL_MIN_GROUP ? largest : g));
}

/**
 * Replace each rebalance date's factor values with their neutralized residuals (in place on the map).
 * 'size' regresses out log(total market cap); 'size_industry' additionally removes SW level-1 industry
 * means (FWL — see stats.residualize). Stocks without a positive market cap that day are dropped (can't
 * be size-neutralized); with industry mode, stocks with no known industry go to an 'unknown' bucket that
 * mergeSmallGroups folds away if tiny.
 */
function neutralizeSeries(
  series: Series,
  snaps: Map<string, Snap>,
  industryByStock: Map<string, IndustrySpell[]>,
  mode: Exclude<Neutral, 'none'>,
): void {
  for (const [date, rows] of series) {
    const snap = snaps.get(date);
    const kept: { tsCode: string }[] = [];
    const values: number[] = [];
    const logCaps: number[] = [];
    const groups: string[] = [];
    for (const row of rows) {
      const mktcap = snap?.get(row.tsCode)?.mktcap ?? 0;
      if (mktcap <= 0) {
        continue;
      }
      kept.push({ tsCode: row.tsCode });
      values.push(row.value);
      logCaps.push(Math.log(mktcap));
      groups.push(
        mode === 'size_industry'
          ? (industryOn(industryByStock.get(row.tsCode), date) ?? 'unknown')
          : '',
      );
    }
    const residuals = st.residualize(
      values,
      logCaps,
      mode === 'size_industry' ? mergeSmallGroups(groups) : undefined,
    );
    series.set(
      date,
      kept.map((k, i) => ({ tsCode: k.tsCode, value: residuals[i] })),
    );
  }
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
  neutral: Neutral = 'none',
  onLog: (msg: string) => void = () => {},
  onUserLog?: UserLogSink,
  locale: Locale = DEFAULT_LOCALE,
  source?: { code: string; label: string },
): Promise<FactorReport> {
  const periodsPerYear = freq === 'week' ? 52 : 12;
  const rebalanceDates = await getRebalanceDates(freq, start, end);
  const freqLabel = t(locale, freq === 'week' ? 'freqWeek' : 'freqMonth');
  onLog(t(locale, 'factorRebalanceDates', { count: rebalanceDates.length, freq: freqLabel }));
  const snaps = await loadSnapshots(rebalanceDates, true); // rebalance snaps carry total market cap for cap-weighting
  onLog(t(locale, 'factorComputingValues', { factor: factorKey }));
  const byDate = await computeFactorSeries(
    factorKey,
    rebalanceDates,
    snaps,
    onLog,
    onUserLog,
    locale,
    source?.code,
  );

  // Cross-sectional neutralization (3.4): replace raw values with residuals before IC / bucketing.
  if (neutral !== 'none') {
    onLog(t(locale, 'factorNeutralizing', { mode: neutral }));
    const industryByStock =
      neutral === 'size_industry' ? await loadIndustryLookup() : new Map<string, IndustrySpell[]>();
    neutralizeSeries(byDate, snaps, industryByStock, neutral);
  }

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
  onLog(t(locale, 'factorLoadingDecaySnapshots', { count: forwardDates.size }));
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
  const bucketReturns: number[][] = Array.from({ length: N_BUCKETS }, () => []); // equal-weight
  const bucketReturnsMktcap: number[][] = Array.from({ length: N_BUCKETS }, () => []); // cap-weight
  const lsReturns: number[] = [];
  const lsReturnsMktcap: number[] = [];
  const lsNetReturns: number[] = []; // long-short after per-rebalance trading cost (equal-weight)
  const lsNetReturnsMktcap: number[] = []; // ditto, cap-weight
  const lsPeriodDates: string[] = []; // period-end date per pushed long-short return (for the NAV x-axis)
  let firstFormationDate: string | null = null; // first non-skipped formation date (NAV starts at 1 here)
  const turnovers: number[] = [];
  // Quantile × forward horizon (daily-normalized): qh[hi][bucket] = per-rebalance-date list of that quantile's daily-average forward return → mean taken at the end
  const qhEqual = IC_DECAY_HORIZONS.map(() =>
    Array.from({ length: N_BUCKETS }, () => [] as number[]),
  );
  const qhMktcap = IC_DECAY_HORIZONS.map(() =>
    Array.from({ length: N_BUCKETS }, () => [] as number[]),
  );
  let prevTop: Set<string> | null = null;
  let prevBottom: Set<string> | null = null;

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

    // Main decile forward returns (next period): equal-weight + cap-weight, plus the top/bottom sets
    // (both legs' membership feeds the net-of-cost turnover).
    const perBucket: { v: number; w: number }[][] = Array.from({ length: N_BUCKETS }, () => []);
    const top = new Set<string>();
    const bottom = new Set<string>();
    for (let i = 0; i < candidates.length; i++) {
      perBucket[buckets[i]].push({ v: fwdW[i], w: candidates[i].mktcap });
      if (buckets[i] === N_BUCKETS - 1) {
        top.add(candidates[i].tsCode);
      } else if (buckets[i] === 0) {
        bottom.add(candidates[i].tsCode);
      }
    }
    for (let b = 0; b < N_BUCKETS; b++) {
      bucketReturns[b].push(equalMean(perBucket[b]));
      bucketReturnsMktcap[b].push(capMean(perBucket[b]));
    }
    const lsGrossEqual = equalMean(perBucket[N_BUCKETS - 1]) - equalMean(perBucket[0]);
    const lsGrossMktcap = capMean(perBucket[N_BUCKETS - 1]) - capMean(perBucket[0]);
    lsReturns.push(lsGrossEqual);
    lsReturnsMktcap.push(lsGrossMktcap);

    // Net-of-cost: charge this rebalance's trading cost. First formation = establish both legs (one side
    // each ≈ one round-trip); later = churn both legs by their turnover × round-trip. Both legs trade, so
    // top and bottom turnover each contribute. Same cost applies to the equal- and cap-weight streams.
    const periodCost =
      prevTop && prevBottom
        ? (oneWayTurnover(top, prevTop) + oneWayTurnover(bottom, prevBottom)) * ROUND_TRIP_COST
        : BUY_COST + SELL_COST; // establishment of the two legs
    lsNetReturns.push(lsGrossEqual - periodCost);
    lsNetReturnsMktcap.push(lsGrossMktcap - periodCost);
    lsPeriodDates.push(nextDate);
    firstFormationDate ??= date;

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
          hb[buckets[i]].push({ v: Math.pow(1 + ret, 1 / h) - 1, w: candidates[i].mktcap }); // daily-normalized
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
      turnovers.push(oneWayTurnover(top, prevTop));
    }
    prevTop = top;
    prevBottom = bottom;
  }

  onLog(t(locale, 'factorAggregating'));
  // Preset and custom factors both label from their Factor row (presets are seeded code rows).
  const label =
    source?.label ??
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

  // Equal-weight long-short NAV, gross vs net-of-cost — the tradability view. navFromReturns prepends a
  // starting 1, so both series are one longer than the period count; dates lead with the first formation.
  const lsNav =
    firstFormationDate != null
      ? {
          dates: [firstFormationDate, ...lsPeriodDates],
          gross: st.navFromReturns(lsReturns),
          net: st.navFromReturns(lsNetReturns),
        }
      : undefined;

  return {
    factor: factorKey,
    label,
    freq,
    neutral,
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
    longShortNet: toLongShort(lsNetReturns),
    longShortNetMktcap: toLongShort(lsNetReturnsMktcap),
    lsNav,
  };
}

// —— weighting helpers ——

/** One-way turnover of a decile leg: fraction of the current names that weren't in the previous set. */
function oneWayTurnover(current: Set<string>, previous: Set<string>): number {
  if (!current.size) {
    return 0;
  }
  let changed = 0;
  for (const code of current) {
    if (!previous.has(code)) {
      changed++;
    }
  }
  return changed / current.size;
}

/** Equal-weight mean of a bucket's values. */
function equalMean(items: { v: number }[]): number {
  return items.length ? items.reduce((s, x) => s + x.v, 0) / items.length : 0;
}

/** Cap-weight mean: Σ(v·w) / Σw (w = total market cap); 0 if the bucket has no positive-cap names. */
function capMean(items: { v: number; w: number }[]): number {
  let sumW = 0;
  let sumVW = 0;
  for (const x of items) {
    sumW += x.w;
    sumVW += x.v * x.w;
  }
  return sumW > 0 ? sumVW / sumW : 0;
}
