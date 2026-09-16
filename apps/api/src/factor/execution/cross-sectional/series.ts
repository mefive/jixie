import { t } from '#i18n/messages.js';
import { prisma } from '#infra/database/prisma.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { FactorBar } from '@jixie/shared';
import { DEFAULT_LOCALE, type FactorLanguage, type Locale } from '@jixie/shared';
import { compilePythonCrossSectionalFactor } from '../../runtime/python/cross-sectional.js';
import { compileFactor, type FactorBatchItem } from '../../runtime/typescript/compile-factor.js';
import { finaAsOf, loadFinaIndex, type FinaIndex, type Snap } from './data.js';
import { LEGACY_POLICY } from './policy.js';

export interface FactorSeriesAudit {
  declaredWindowDays?: number;
  minimumCoverage: number;
  coverageSum: number;
  observations: number;
  droppedForCoverage: number;
}

export interface FactorSeriesResult {
  series: Series;
  audit: FactorSeriesAudit;
}

export function mergeFactorSeriesAudits(audits: FactorSeriesAudit[]): FactorSeriesAudit {
  return {
    declaredWindowDays:
      Math.max(0, ...audits.map((audit) => audit.declaredWindowDays ?? 0)) || undefined,
    minimumCoverage: Math.min(...audits.map((audit) => audit.minimumCoverage)),
    coverageSum: audits.reduce((sum, audit) => sum + audit.coverageSum, 0),
    observations: audits.reduce((sum, audit) => sum + audit.observations, 0),
    droppedForCoverage: audits.reduce((sum, audit) => sum + audit.droppedForCoverage, 0),
  };
}

export type Series = Map<string, { tsCode: string; value: number }[]>; // rebalance date -> [{tsCode, value}]

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
  minimumWindowCoverage = LEGACY_POLICY.minimumWindowCoverage,
  preloadedFinaIndex?: FinaIndex,
  factorLanguage?: FactorLanguage,
): Promise<FactorSeriesResult> {
  const series: Series = new Map();
  const audit: FactorSeriesAudit = {
    minimumCoverage: minimumWindowCoverage,
    coverageSum: 0,
    observations: 0,
    droppedForCoverage: 0,
  };
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
    : await prisma.factor.findUnique({
        where: { id: factorKey },
        select: { code: true, language: true },
      });
  const factorCode = factorCodeSnapshot ?? currentFactor?.code;
  const language = factorLanguage ?? normalizeFactorLanguage(currentFactor?.language);
  if (!factorCode) {
    onLog(t(locale, 'factorMissing', { factor: factorKey }));
    return { series, audit };
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
  const factor =
    language === 'python'
      ? await compilePythonCrossSectionalFactor(factorCode, logSink)
      : await compileFactor(factorCode, logSink);
  const effectiveMinimumCoverage = factor.minCoverage ?? minimumWindowCoverage;
  audit.declaredWindowDays = factor.window;
  audit.minimumCoverage = effectiveMinimumCoverage;
  const needsTurnoverRateFHistory = factorSourceReferencesHistoryField(
    factorCode,
    language === 'python' ? 'turnover_rate_f' : 'turnoverRateF',
  );
  const needsRoeHistory = factorSourceReferencesHistoryField(factorCode, 'roe');
  const needsGrossProfitMarginHistory = factorSourceReferencesHistoryField(
    factorCode,
    language === 'python' ? 'grossprofit_margin' : 'grossprofitMargin',
  );
  const needsMarketCloseHistory = factorSourceReferencesHistoryField(
    factorCode,
    language === 'python' ? 'market_close' : 'marketClose',
  );
  const marketCloseByDate = needsMarketCloseHistory
    ? new Map(
        (
          await prisma.indexDaily.findMany({
            where: { tsCode: '000985.CSI' },
            select: { tradeDate: true, close: true },
          })
        ).map((row) => [row.tradeDate, row.close]),
      )
    : new Map<string, number>();

  // Preload all financial reports once (PIT-gated by annDate); loadBars picks each stock's as-of report.
  const finaIndex = preloadedFinaIndex ?? (await loadFinaIndex());

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
        roa: null,
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
        bar.roa = fina.roa;
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
      return { series, audit };
    }
    const rebalanceSet = new Set(dates);
    const marketDates = (
      await prisma.tradeCal.findMany({
        where: { exchange: 'SSE', isOpen: 1, calDate: { lte: dates.at(-1) ?? '00000000' } },
        select: { calDate: true },
        orderBy: { calDate: 'asc' },
      })
    ).map((row) => row.calDate);
    const marketDateIndex = new Map(marketDates.map((date, index) => [date, index]));
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
          select: { tradeDate: true, close: true, amount: true },
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
      const amounts: (number | null)[] = [];
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
        amounts.push(r.amount);
      }
      // Point-in-time ROE per trading day (as-of announcement date) — a step series aligned with
      // tradeDates; only materialized when the factor actually reads the 'roe' history.
      const roes: (number | null)[] = needsRoeHistory
        ? tradeDates.map((tradeDate) => finaAsOf(finaIndex, tsCode, tradeDate)?.roe ?? null)
        : [];
      const grossProfitMargins: (number | null)[] = needsGrossProfitMarginHistory
        ? tradeDates.map(
            (tradeDate) => finaAsOf(finaIndex, tsCode, tradeDate)?.grossprofitMargin ?? null,
          )
        : [];
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
        const marketEnd = marketDateIndex.get(date);
        if (marketEnd == null) {
          continue;
        }
        const coverage = calculateWindowCoverage(tradeDates, end, marketDates, marketEnd, window);
        audit.coverageSum += coverage;
        audit.observations += 1;
        if (coverage < effectiveMinimumCoverage) {
          audit.droppedForCoverage += 1;
          continue;
        }
        const from = Math.max(0, end - window + 1);
        items.push({
          bar: barsByDate.get(date)?.get(tsCode) ?? { ...EMPTY_BAR, code: tsCode },
          closes: adjClose.slice(from, end + 1),
          dates: tradeDates.slice(from, end + 1),
          amounts: amounts.slice(from, end + 1),
          turnoverRatesF: tradeDates
            .slice(from, end + 1)
            .map((tradeDate) => turnoverRateFMap.get(tradeDate) ?? null),
          roes: needsRoeHistory ? roes.slice(from, end + 1) : undefined,
          grossProfitMargins: needsGrossProfitMarginHistory
            ? grossProfitMargins.slice(from, end + 1)
            : undefined,
          marketCloses: needsMarketCloseHistory
            ? tradeDates
                .slice(from, end + 1)
                .map((tradeDate) => marketCloseByDate.get(tradeDate) ?? null)
            : undefined,
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
  return { series, audit };
}

export function factorSourceReferencesHistoryField(source: string, field: string): boolean {
  return [`'${field}'`, `"${field}"`, `\`${field}\``].some((literal) => source.includes(literal));
}

function normalizeFactorLanguage(value: string | null | undefined): FactorLanguage {
  return value === 'python' ? 'python' : 'typescript';
}

function lowerBound(values: string[], target: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export function calculateWindowCoverage(
  stockTradeDates: string[],
  stockEndIndex: number,
  marketTradeDates: string[],
  marketEndIndex: number,
  window: number,
): number {
  const marketStartDate = marketTradeDates[Math.max(0, marketEndIndex - window + 1)];
  if (!marketStartDate) {
    return 0;
  }
  const observedStart = lowerBound(stockTradeDates, marketStartDate);
  const observed = stockEndIndex - observedStart + 1;
  const expected = Math.min(window, marketEndIndex + 1);
  return expected > 0 ? Math.max(0, observed) / expected : 0;
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
  roa: null,
  grossprofitMargin: null,
  debtToAssets: null,
};
