import type { Prisma } from '#infra/database/prisma.js';
import { formatNumber } from '../quality/format.js';
import type {
  AuditFinding,
  ExternalMarketPitAuditRow,
  ExternalMarketPitAuditSummary,
} from '../quality/report.js';
import { CROSS_MARKET_BENCHMARKS } from '../registry/cross-market-benchmarks.js';
import { EXTERNAL_FX_CODES } from '../registry/fx.js';
import { US_NOMINAL_CURVE_CODE, US_REAL_CURVE_CODE } from '../registry/yield-curves.js';

export interface CrossMarketBenchmarkPitAuditRow {
  benchmarkId: string;
  market: 'CN' | 'HK' | 'US';
  tradeDate: string;
  availableDate: string;
  close: number;
}

export interface CrossMarketBenchmarkPitAuditSummary {
  missingBenchmarks: string[];
  invalidAvailabilityRows: number;
  nonTradingAvailabilityRows: number;
  invalidValueRows: number;
  latestAvailableByBenchmark: Record<string, string | null>;
}

export function summarizeExternalMarketPit(
  rows: ExternalMarketPitAuditRow[],
  openDates: Set<string>,
): ExternalMarketPitAuditSummary {
  const requiredSeries = [US_NOMINAL_CURVE_CODE, US_REAL_CURVE_CODE, ...EXTERNAL_FX_CODES];
  const observedSeries = new Set(rows.map((row) => row.seriesKey));
  const availableDates = rows.map((row) => row.availableDate).sort();
  return {
    missingSeries: requiredSeries.filter((seriesKey) => !observedSeries.has(seriesKey)),
    invalidAvailabilityRows: rows.filter((row) => row.availableDate <= row.tradeDate).length,
    nonTradingAvailabilityRows: rows.filter((row) => !openDates.has(row.availableDate)).length,
    invalidValueRows: rows.filter((row) => !row.validValue).length,
    latestAvailableDate: availableDates.at(-1) ?? null,
  };
}

export function summarizeCrossMarketBenchmarkPit(
  rows: CrossMarketBenchmarkPitAuditRow[],
  openDates: Set<string>,
): CrossMarketBenchmarkPitAuditSummary {
  const expectedIds = CROSS_MARKET_BENCHMARKS.map((benchmark) => benchmark.id);
  const observedIds = new Set(rows.map((row) => row.benchmarkId));
  return {
    missingBenchmarks: expectedIds.filter((id) => !observedIds.has(id)),
    invalidAvailabilityRows: rows.filter((row) =>
      row.market === 'CN'
        ? row.availableDate !== row.tradeDate
        : row.availableDate <= row.tradeDate,
    ).length,
    nonTradingAvailabilityRows: rows.filter((row) => !openDates.has(row.availableDate)).length,
    invalidValueRows: rows.filter((row) => !Number.isFinite(row.close) || row.close <= 0).length,
    latestAvailableByBenchmark: Object.fromEntries(
      expectedIds.map((id) => [
        id,
        rows
          .filter((row) => row.benchmarkId === id)
          .map((row) => row.availableDate)
          .sort()
          .at(-1) ?? null,
      ]),
    ),
  };
}

export async function auditExternalMarketPit(
  database: Prisma,
  endDate: string,
): Promise<AuditFinding> {
  const [curveRows, fxRows] = await Promise.all([
    database.yieldCurvePoint.findMany({
      where: {
        curveCode: { in: [US_NOMINAL_CURVE_CODE, US_REAL_CURVE_CODE] },
        termYears: 10,
      },
      select: {
        curveCode: true,
        tradeDate: true,
        availableDate: true,
        yieldPct: true,
      },
    }),
    database.fxDaily.findMany({
      where: { tsCode: { in: [...EXTERNAL_FX_CODES] } },
      select: {
        tsCode: true,
        tradeDate: true,
        availableDate: true,
        bidClose: true,
        askClose: true,
      },
    }),
  ]);
  const rows: ExternalMarketPitAuditRow[] = [
    ...curveRows.map((row) => ({
      seriesKey: row.curveCode,
      tradeDate: row.tradeDate,
      availableDate: row.availableDate,
      validValue: Number.isFinite(row.yieldPct) && row.yieldPct > -10 && row.yieldPct < 30,
    })),
    ...fxRows.map((row) => ({
      seriesKey: row.tsCode,
      tradeDate: row.tradeDate,
      availableDate: row.availableDate,
      validValue:
        Number.isFinite(row.bidClose) &&
        Number.isFinite(row.askClose) &&
        row.bidClose > 0 &&
        row.bidClose <= row.askClose,
    })),
  ];
  const availableDates = rows.map((row) => row.availableDate).sort();
  const firstAvailableDate = availableDates[0];
  const lastAvailableDate = availableDates.at(-1);
  const calendarRows =
    firstAvailableDate && lastAvailableDate
      ? await database.tradeCal.findMany({
          where: {
            exchange: 'SSE',
            isOpen: 1,
            calDate: { gte: firstAvailableDate, lte: lastAvailableDate },
          },
          select: { calDate: true },
        })
      : [];
  const summary = summarizeExternalMarketPit(rows, new Set(calendarRows.map((row) => row.calDate)));
  const broken =
    summary.missingSeries.length > 0 ||
    summary.invalidAvailabilityRows > 0 ||
    summary.nonTradingAvailabilityRows > 0 ||
    summary.invalidValueRows > 0;
  const stale = summary.latestAvailableDate != null && summary.latestAvailableDate < endDate;

  return {
    id: 'external-market-pit',
    title: 'External market drivers: point-in-time availability',
    status: broken ? 'error' : stale ? 'warn' : 'pass',
    summary: `${formatNumber(rows.length)} daily observations; ${summary.invalidAvailabilityRows} invalid availability rows; ${summary.nonTradingAvailabilityRows} non-trading availability dates`,
    details: [
      `Missing required series: ${summary.missingSeries.length === 0 ? 'none' : summary.missingSeries.join(', ')}.`,
      `${summary.invalidValueRows} rows have invalid yields or inverted FX close quotes.`,
      `Latest China-market availability: ${summary.latestAvailableDate ?? 'none'}; audit end: ${endDate}.`,
      'US curves and GMT FX bars must use the first strictly later SSE session; same-calendar-day use is prohibited.',
    ],
  };
}

export async function auditCrossMarketBenchmarkPit(
  database: Prisma,
  endDate: string,
): Promise<AuditFinding> {
  const [benchmarkRows, proxyMetadata, proxyCoverage] = await Promise.all([
    database.marketBenchmarkDaily.findMany({
      where: { benchmarkId: { in: CROSS_MARKET_BENCHMARKS.map((item) => item.id) } },
      select: {
        benchmarkId: true,
        tradeDate: true,
        availableDate: true,
        close: true,
        benchmark: { select: { market: true } },
      },
    }),
    database.etfBasic.findMany({
      where: {
        tsCode: { in: CROSS_MARKET_BENCHMARKS.map((item) => item.tradableProxyTsCode) },
      },
      select: { tsCode: true, listStatus: true },
    }),
    database.etfDaily.groupBy({
      by: ['tsCode'],
      where: {
        tsCode: { in: CROSS_MARKET_BENCHMARKS.map((item) => item.tradableProxyTsCode) },
      },
      _count: { _all: true },
      _max: { tradeDate: true },
    }),
  ]);
  const rows: CrossMarketBenchmarkPitAuditRow[] = benchmarkRows.flatMap((row) =>
    row.benchmark.market === 'CN' || row.benchmark.market === 'HK' || row.benchmark.market === 'US'
      ? [
          {
            benchmarkId: row.benchmarkId,
            market: row.benchmark.market,
            tradeDate: row.tradeDate,
            availableDate: row.availableDate,
            close: row.close,
          },
        ]
      : [],
  );
  const availableDates = rows.map((row) => row.availableDate).sort();
  const firstAvailableDate = availableDates[0];
  const lastAvailableDate = availableDates.at(-1);
  const calendarRows =
    firstAvailableDate && lastAvailableDate
      ? await database.tradeCal.findMany({
          where: {
            exchange: 'SSE',
            isOpen: 1,
            calDate: { gte: firstAvailableDate, lte: lastAvailableDate },
          },
          select: { calDate: true },
        })
      : [];
  const summary = summarizeCrossMarketBenchmarkPit(
    rows,
    new Set(calendarRows.map((row) => row.calDate)),
  );
  const metadataCodes = new Set(
    proxyMetadata.filter((row) => row.listStatus === 'L').map((row) => row.tsCode),
  );
  const coverageByCode = new Map(proxyCoverage.map((row) => [row.tsCode, row]));
  const missingProxyMetadata = CROSS_MARKET_BENCHMARKS.filter(
    (benchmark) => !metadataCodes.has(benchmark.tradableProxyTsCode),
  ).map((benchmark) => benchmark.tradableProxyTsCode);
  const missingProxyPrices = CROSS_MARKET_BENCHMARKS.filter(
    (benchmark) => (coverageByCode.get(benchmark.tradableProxyTsCode)?._count._all ?? 0) === 0,
  ).map((benchmark) => benchmark.tradableProxyTsCode);
  const broken =
    summary.missingBenchmarks.length > 0 ||
    summary.invalidAvailabilityRows > 0 ||
    summary.nonTradingAvailabilityRows > 0 ||
    summary.invalidValueRows > 0 ||
    missingProxyMetadata.length > 0 ||
    missingProxyPrices.length > 0;
  const staleBenchmarks = Object.entries(summary.latestAvailableByBenchmark)
    .filter(([, date]) => date != null && date < endDate)
    .map(([id, date]) => `${id}=${date}`);

  return {
    id: 'cross-market-benchmarks',
    title: 'Cross-market price benchmarks and tradable proxies',
    status: broken ? 'error' : staleBenchmarks.length > 0 ? 'warn' : 'pass',
    summary: `${formatNumber(rows.length)} benchmark bars; ${summary.invalidAvailabilityRows} invalid availability rows; ${summary.nonTradingAvailabilityRows} non-SSE availability dates`,
    details: [
      `Missing benchmarks: ${summary.missingBenchmarks.length === 0 ? 'none' : summary.missingBenchmarks.join(', ')}.`,
      `Missing listed proxy metadata: ${missingProxyMetadata.length === 0 ? 'none' : missingProxyMetadata.join(', ')}; proxies without prices: ${missingProxyPrices.length === 0 ? 'none' : missingProxyPrices.join(', ')}.`,
      `Latest availability: ${Object.entries(summary.latestAvailableByBenchmark)
        .map(([id, date]) => `${id}=${date ?? 'none'}`)
        .join(', ')}; audit end: ${endDate}.`,
      `Benchmarks behind the audit end (often because source markets were closed): ${staleBenchmarks.length === 0 ? 'none' : staleBenchmarks.join(', ')}.`,
      'All three series are price indices, not total-return indices. The HK and US closes are gated to the first strictly later SSE session; China uses its local close date.',
      'CNY returns use USD/CNH directly for SPX and USDCNH divided by USDHKD for HSI. ETF proxies remain separate executable instruments with their own fees, tracking error, and trading calendar.',
    ],
  };
}
