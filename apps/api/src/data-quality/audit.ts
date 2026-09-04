import { median, quantile } from '../lib/stats.js';
import { CHINA_MACRO_SERIES } from '../macro/china-macro.js';
import { US_HEADLINE_CPI_SERIES_KEY } from '../macro/us-headline-cpi.js';
import type { Prisma } from '../lib/prisma.js';
import { auditCommodityWarehouseReceipts } from '../commodity/commodity-warehouse-receipt-quality.js';
import { auditCommodityHoldingPositions } from '../commodity/commodity-holding-quality.js';
import { auditCommodityContinuousReturns } from '../commodity/commodity-continuous-return-quality.js';
import { auditMacroRiskAxes } from '../risk/macro-risk-quality.js';
import { auditMarketRiskDrivers } from '../risk/market-risk-quality.js';
import { CROSS_MARKET_BENCHMARKS } from '../market/cross-market-benchmarks.js';
import { auditEtfResearchRegistry } from './etf-registry-audit.js';
import { CHINABOND_PUBLIC_CURVES } from '../rates/chinabond-credit-curves.js';
import {
  EXTERNAL_FX_CODES,
  US_NOMINAL_CURVE_CODE,
  US_REAL_CURVE_CODE,
} from '../rates/external-market-drivers.js';

export type AuditStatus = 'pass' | 'warn' | 'error';

export interface AuditFinding {
  id: string;
  title: string;
  status: AuditStatus;
  summary: string;
  details: string[];
}

export interface DataQualityAuditReport {
  generatedAt: string;
  scope: {
    startDate: string;
    endDate: string;
    openTradingDays: number;
    windowTradingDays: number;
  };
  findings: AuditFinding[];
}

interface DateCount {
  tradeDate: string;
  count: number;
}

interface CalendarCoverage {
  observedStart: string | null;
  observedEnd: string | null;
  leadingMissingDates: string[];
  internalMissingDates: string[];
  trailingMissingDates: string[];
  sharpDropDates: Array<{ tradeDate: string; count: number; referenceMedian: number }>;
  minimumRows: number;
  medianRows: number;
  maximumRows: number;
}

interface NullCountRow {
  source: 'daily' | 'dailyBasic';
  total: bigint | number;
  closeMissing: bigint | number;
  amountMissing: bigint | number;
  pbMissing: bigint | number;
  totalMvMissing: bigint | number;
  circMvMissing: bigint | number;
  turnoverRateMissing: bigint | number;
  turnoverRateFMissing: bigint | number;
}

interface AdjustmentJumpRow {
  tsCode: string;
  tradeDate: string;
  previousFactor: number;
  adjFactor: number;
  changeFraction: number;
  totalCount: bigint | number;
}

interface StockMasterRow {
  listStatus: string;
  count: bigint | number;
}

interface StockCoverageRow {
  dailyCodes: bigint | number;
  unexplainedOrphanCodes: bigint | number;
  aliasedDailyCodes: bigint | number;
}

interface FinancialPitRow {
  total: bigint | number;
  missingAnnouncementDate: bigint | number;
  announcementBeforePeriodEnd: bigint | number;
}

export interface FinancialStatementVersionAuditRow {
  total: bigint | number;
  invalidAnnouncementDate: bigint | number;
  invalidAvailableDate: bigint | number;
  invalidQuality: bigint | number;
  invalidReportScope: bigint | number;
}

export interface FinancialStatementReconciliationRow {
  indicatorPeriods: bigint | number;
  incomeMatches: bigint | number;
  balanceMatches: bigint | number;
  cashFlowMatches: bigint | number;
}

export interface FinancialAccountingIdentityAuditRow {
  comparable: bigint | number;
  mismatches: bigint | number;
  anomalies: bigint | number;
}

export interface FinancialMetricCoverageAuditRow {
  totalPeriods: bigint | number;
  completePeriods: bigint | number;
}

interface WindowCoverageRow {
  tsCode: string;
  observedDays: bigint | number;
}

export interface MacroPitAuditRow {
  seriesKey: string;
  period: string;
  releaseDate: string | null;
  availableDate: string;
  availabilityKind: string;
  vintageKind: string;
}

export interface MacroPitAuditSummary {
  missingSeries: string[];
  invalidAvailabilityRows: number;
  nonTradingAvailabilityRows: number;
  conservativeLagRows: number;
  latestValueBackfillRows: number;
  capturedAsAvailableRows: number;
}

export interface ExternalMarketPitAuditRow {
  seriesKey: string;
  tradeDate: string;
  availableDate: string;
  validValue: boolean;
}

export interface ExternalMarketPitAuditSummary {
  missingSeries: string[];
  invalidAvailabilityRows: number;
  nonTradingAvailabilityRows: number;
  invalidValueRows: number;
  latestAvailableDate: string | null;
}

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

export interface CreditCurvePitAuditSummary extends ExternalMarketPitAuditSummary {
  staleSeries: string[];
}

export interface WindowCoverageSummary {
  evaluationDate: string;
  windowStart: string;
  eligibleStocks: number;
  medianCoverage: number;
  tenthPercentileCoverage: number;
  belowMinimumCount: number;
}

export interface DataQualityAuditOptions {
  startDate?: string;
  endDate?: string;
  windowTradingDays?: number;
  evaluationPoints?: number;
}

const DATE_PATTERN = /^\d{8}$/;
const MINIMUM_WINDOW_COVERAGE = 2 / 3;
const DENSE_TABLES = [
  { id: 'daily', title: 'Daily bars' },
  { id: 'adj-factor', title: 'Adjustment factors' },
  { id: 'daily-basic', title: 'Daily valuation metrics' },
  { id: 'moneyflow', title: 'Daily money flow' },
  { id: 'stk-limit', title: 'Daily price limits' },
  { id: 'sw-index-daily', title: 'SW2021 Level-1 industry bars' },
] as const;

export async function runDataQualityAudit(
  database: Prisma,
  options: DataQualityAuditOptions = {},
): Promise<DataQualityAuditReport> {
  const dailyBounds = await database.daily.aggregate({
    _min: { tradeDate: true },
    _max: { tradeDate: true },
  });
  const availableStart = dailyBounds._min.tradeDate;
  const availableEnd = dailyBounds._max.tradeDate;
  if (!availableStart || !availableEnd) {
    throw new Error('Daily is empty; sync market data before running the audit');
  }

  const startDate = options.startDate ?? availableStart;
  const endDate = options.endDate ?? availableEnd;
  validateDateRange(startDate, endDate);
  const windowTradingDays = options.windowTradingDays ?? 60;
  const evaluationPoints = options.evaluationPoints ?? 5;
  if (!Number.isInteger(windowTradingDays) || windowTradingDays < 20 || windowTradingDays > 504) {
    throw new Error('windowTradingDays must be an integer between 20 and 504');
  }
  if (!Number.isInteger(evaluationPoints) || evaluationPoints < 1 || evaluationPoints > 12) {
    throw new Error('evaluationPoints must be an integer between 1 and 12');
  }

  const calendarRows = await database.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gte: startDate, lte: endDate },
    },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const openDates = calendarRows.map((row) => row.calDate);
  if (openDates.length === 0) {
    throw new Error(`TradeCal has no SSE open days in ${startDate}..${endDate}`);
  }

  const denseDateCounts = await loadDenseDateCounts(database, startDate, endDate);
  const findings: AuditFinding[] = DENSE_TABLES.map((table) =>
    buildDenseCoverageFinding(table.id, table.title, openDates, denseDateCounts[table.id]),
  );

  findings.push(
    await auditSparseTopList(database, startDate, endDate),
    await auditKeyNullRates(database, startDate, endDate),
    await auditAdjustmentJumps(database, startDate, endDate),
    await auditStockUniverse(database),
    await auditHistoricalInvestability(database),
    await auditEtfRegistry(database, openDates.at(-1)!),
    await auditWindowCoverage(database, openDates, windowTradingDays, evaluationPoints),
    await auditFinancialPit(database),
    await auditFinancialStatementVersions(database),
    await auditFinancialStatementAccounting(database),
    await auditMacroPit(database),
    await auditExternalMarketPit(database, endDate),
    await auditCrossMarketBenchmarkPit(database, endDate),
    await auditCreditCurvePit(database, endDate),
    await auditCommodityWarehouseReceiptPit(database, startDate, endDate),
    await auditCommodityHoldingPit(database, startDate, endDate),
    await auditCommodityContinuousReturnPit(database, startDate, endDate),
    await auditMarketRiskDriverPit(database, startDate, endDate),
    await auditMacroRiskAxisPit(database, startDate, endDate),
  );

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      startDate,
      endDate,
      openTradingDays: openDates.length,
      windowTradingDays,
    },
    findings,
  };
}

async function auditEtfRegistry(database: Prisma, endDate: string): Promise<AuditFinding> {
  const summary = await auditEtfResearchRegistry(database, {
    expectedHistoryStart: '20150101',
    coverageThrough: endDate,
  });
  const dailyRows = summary.rows.reduce((total, row) => total + row.dailyRows, 0);
  const adjustmentRows = summary.rows.reduce((total, row) => total + row.adjustmentRows, 0);
  const shareSizeRows = summary.rows.reduce((total, row) => total + row.shareSizeRows, 0);

  return {
    id: 'etf-research-registry',
    title: 'ETF research registry: metadata and historical coverage',
    status: summary.errors.length > 0 ? 'error' : summary.warnings.length > 0 ? 'warn' : 'pass',
    summary: `${formatNumber(summary.exposures)} exposures / ${formatNumber(summary.products)} products; ${summary.errors.length} errors / ${summary.warnings.length} source warnings`,
    details: [
      `Registry v${summary.registryVersion}, selected ${summary.selectionAsOf}; audited ${summary.expectedHistoryStart}..${summary.coverageThrough}.`,
      `${formatNumber(dailyRows)} daily bars; ${formatNumber(adjustmentRows)} adjustment factors; ${formatNumber(shareSizeRows)} share-size observations.`,
      ...summary.errors.slice(0, 20).map((error) => `Error: ${error}.`),
      ...summary.warnings.slice(0, 20).map((warning) => `Warning: ${warning}.`),
      ...(summary.errors.length + summary.warnings.length > 20
        ? ['Additional registry findings are available from pnpm --filter api audit:etf.']
        : []),
      'Share-size source gaps are preserved as missing observations; no backward fill or same-day look-ahead is allowed.',
    ],
  };
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

export function summarizeCreditCurvePit(
  rows: ExternalMarketPitAuditRow[],
  openDates: Set<string>,
  endDate: string,
): CreditCurvePitAuditSummary {
  const requiredSeries = CHINABOND_PUBLIC_CURVES.map((curve) => curve.curveCode);
  const observedSeries = new Set(rows.map((row) => row.seriesKey));
  const availableDates = rows.map((row) => row.availableDate).sort();
  return {
    missingSeries: requiredSeries.filter((seriesKey) => !observedSeries.has(seriesKey)),
    invalidAvailabilityRows: rows.filter((row) => row.availableDate <= row.tradeDate).length,
    nonTradingAvailabilityRows: rows.filter((row) => !openDates.has(row.availableDate)).length,
    invalidValueRows: rows.filter((row) => !row.validValue).length,
    latestAvailableDate: availableDates.at(-1) ?? null,
    staleSeries: requiredSeries.filter((seriesKey) => {
      const latest = rows
        .filter((row) => row.seriesKey === seriesKey)
        .map((row) => row.availableDate)
        .sort()
        .at(-1);
      return latest != null && latest < endDate;
    }),
  };
}

export function summarizeMacroPit(
  observedSeries: string[],
  observations: MacroPitAuditRow[],
  openDates: Set<string>,
): MacroPitAuditSummary {
  const observed = new Set(observedSeries);
  return {
    missingSeries: [
      ...CHINA_MACRO_SERIES.map((definition) => definition.seriesKey),
      US_HEADLINE_CPI_SERIES_KEY,
    ].filter((seriesKey) => !observed.has(seriesKey)),
    invalidAvailabilityRows: observations.filter(
      (row) =>
        (row.releaseDate != null && row.availableDate < row.releaseDate) ||
        (row.availabilityKind === 'official_schedule' && row.releaseDate == null) ||
        (row.availabilityKind === 'conservative_lag' && row.releaseDate != null) ||
        (row.availabilityKind === 'published_intraday' && row.releaseDate !== row.period) ||
        !['official_schedule', 'published_intraday', 'conservative_lag'].includes(
          row.availabilityKind,
        ),
    ).length,
    nonTradingAvailabilityRows: observations.filter((row) => !openDates.has(row.availableDate))
      .length,
    conservativeLagRows: observations.filter((row) => row.availabilityKind === 'conservative_lag')
      .length,
    latestValueBackfillRows: observations.filter(
      (row) => row.vintageKind === 'latest_value_backfill',
    ).length,
    capturedAsAvailableRows: observations.filter(
      (row) => row.vintageKind === 'captured_as_available',
    ).length,
  };
}

export function analyzeCalendarCoverage(
  openDates: string[],
  dateCounts: DateCount[],
): CalendarCoverage {
  const sortedCounts = [...dateCounts].sort((left, right) =>
    left.tradeDate.localeCompare(right.tradeDate),
  );
  const observedStart = sortedCounts[0]?.tradeDate ?? null;
  const observedEnd = sortedCounts.at(-1)?.tradeDate ?? null;
  const countByDate = new Map(sortedCounts.map((row) => [row.tradeDate, row.count]));
  const leadingMissingDates: string[] = [];
  const internalMissingDates: string[] = [];
  const trailingMissingDates: string[] = [];

  for (const date of openDates) {
    if (countByDate.has(date)) {
      continue;
    }
    if (!observedStart || date < observedStart) {
      leadingMissingDates.push(date);
    } else if (observedEnd && date > observedEnd) {
      trailingMissingDates.push(date);
    } else {
      internalMissingDates.push(date);
    }
  }

  const rowCounts = sortedCounts.map((row) => row.count);
  return {
    observedStart,
    observedEnd,
    leadingMissingDates,
    internalMissingDates,
    trailingMissingDates,
    sharpDropDates: findSharpRowCountDrops(sortedCounts),
    minimumRows: rowCounts.length > 0 ? Math.min(...rowCounts) : 0,
    medianRows: median(rowCounts),
    maximumRows: rowCounts.length > 0 ? Math.max(...rowCounts) : 0,
  };
}

export function findSharpRowCountDrops(
  dateCounts: DateCount[],
  lookback = 20,
  minimumFraction = 0.7,
): Array<{ tradeDate: string; count: number; referenceMedian: number }> {
  const drops: Array<{ tradeDate: string; count: number; referenceMedian: number }> = [];
  for (let index = lookback; index < dateCounts.length; index++) {
    const referenceMedian = median(
      dateCounts.slice(index - lookback, index).map((row) => row.count),
    );
    if (referenceMedian > 0 && dateCounts[index].count < referenceMedian * minimumFraction) {
      drops.push({
        tradeDate: dateCounts[index].tradeDate,
        count: dateCounts[index].count,
        referenceMedian,
      });
    }
  }
  return drops;
}

export function selectEvaluationDates(openDates: string[], count: number): string[] {
  const lastDateByYear = new Map<string, string>();
  for (const date of openDates) {
    lastDateByYear.set(date.slice(0, 4), date);
  }
  const yearEnds = [...lastDateByYear.values()];
  if (yearEnds.length <= count) {
    return yearEnds;
  }
  if (count === 1) {
    return [yearEnds.at(-1)!];
  }

  const selected = new Set<string>();
  for (let index = 0; index < count; index++) {
    const position = Math.round((index * (yearEnds.length - 1)) / (count - 1));
    selected.add(yearEnds[position]);
  }
  return [...selected].sort();
}

export function summarizeWindowCoverage(
  evaluationDate: string,
  windowStart: string,
  expectedDays: number,
  rows: WindowCoverageRow[],
): WindowCoverageSummary {
  const coverage = rows.map((row) => toNumber(row.observedDays) / expectedDays);
  return {
    evaluationDate,
    windowStart,
    eligibleStocks: rows.length,
    medianCoverage: median(coverage),
    tenthPercentileCoverage: quantile(coverage, 0.1),
    belowMinimumCount: coverage.filter((value) => value < MINIMUM_WINDOW_COVERAGE).length,
  };
}

function validateDateRange(startDate: string, endDate: string): void {
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
    throw new Error('Audit dates must use YYYYMMDD');
  }
  if (startDate > endDate) {
    throw new Error('Audit start date must not be after end date');
  }
}

async function loadDenseDateCounts(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<Record<(typeof DENSE_TABLES)[number]['id'], DateCount[]>> {
  const range = { gte: startDate, lte: endDate };
  const [daily, adjFactor, dailyBasic, moneyflow, stkLimit, swIndexDaily] = await Promise.all([
    database.daily.groupBy({
      by: ['tradeDate'],
      where: { tradeDate: range },
      _count: { _all: true },
      orderBy: { tradeDate: 'asc' },
    }),
    database.adjFactor.groupBy({
      by: ['tradeDate'],
      where: { tradeDate: range },
      _count: { _all: true },
      orderBy: { tradeDate: 'asc' },
    }),
    database.dailyBasic.groupBy({
      by: ['tradeDate'],
      where: { tradeDate: range },
      _count: { _all: true },
      orderBy: { tradeDate: 'asc' },
    }),
    database.moneyflow.groupBy({
      by: ['tradeDate'],
      where: { tradeDate: range },
      _count: { _all: true },
      orderBy: { tradeDate: 'asc' },
    }),
    database.stkLimit.groupBy({
      by: ['tradeDate'],
      where: { tradeDate: range },
      _count: { _all: true },
      orderBy: { tradeDate: 'asc' },
    }),
    database.swIndexDaily.groupBy({
      by: ['tradeDate'],
      where: { tradeDate: range },
      _count: { _all: true },
      orderBy: { tradeDate: 'asc' },
    }),
  ]);
  const normalize = (rows: Array<{ tradeDate: string; _count: { _all: number } }>) =>
    rows.map((row) => ({ tradeDate: row.tradeDate, count: row._count._all }));

  return {
    daily: normalize(daily),
    'adj-factor': normalize(adjFactor),
    'daily-basic': normalize(dailyBasic),
    moneyflow: normalize(moneyflow),
    'stk-limit': normalize(stkLimit),
    'sw-index-daily': normalize(swIndexDaily),
  };
}

function buildDenseCoverageFinding(
  id: string,
  title: string,
  openDates: string[],
  dateCounts: DateCount[],
): AuditFinding {
  const coverage = analyzeCalendarCoverage(openDates, dateCounts);
  const hasInternalGap = coverage.internalMissingDates.length > 0;
  const hasBoundaryGap =
    coverage.leadingMissingDates.length > 0 || coverage.trailingMissingDates.length > 0;
  const hasSharpDrop = coverage.sharpDropDates.length > 0;
  const status: AuditStatus = hasInternalGap
    ? 'error'
    : hasBoundaryGap || hasSharpDrop
      ? 'warn'
      : 'pass';
  const details = [
    `Observed ${coverage.observedStart ?? 'n/a'}..${coverage.observedEnd ?? 'n/a'}; rows/day min ${coverage.minimumRows}, median ${formatNumber(coverage.medianRows)}, max ${coverage.maximumRows}.`,
  ];
  appendDateList(details, 'Leading uncovered open days', coverage.leadingMissingDates);
  appendDateList(details, 'Internal missing open days', coverage.internalMissingDates);
  appendDateList(details, 'Trailing uncovered open days', coverage.trailingMissingDates);
  if (hasSharpDrop) {
    details.push(
      `Sharp row-count drops: ${coverage.sharpDropDates.length} (${coverage.sharpDropDates
        .slice(0, 8)
        .map(
          (row) =>
            `${row.tradeDate}=${row.count} vs prior median ${formatNumber(row.referenceMedian)}`,
        )
        .join(', ')}${coverage.sharpDropDates.length > 8 ? ', …' : ''}).`,
    );
  }

  return {
    id: `calendar-${id}`,
    title: `${title}: calendar coverage`,
    status,
    summary:
      status === 'pass'
        ? `${dateCounts.length} open dates are continuous`
        : `${coverage.leadingMissingDates.length} leading, ${coverage.internalMissingDates.length} internal, ${coverage.trailingMissingDates.length} trailing gaps; ${coverage.sharpDropDates.length} sharp drops`,
    details,
  };
}

async function auditSparseTopList(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const aggregate = await database.topList.aggregate({
    where: { tradeDate: { gte: startDate, lte: endDate } },
    _min: { tradeDate: true },
    _max: { tradeDate: true },
    _count: { _all: true },
  });
  const activeDates = await database.topList.groupBy({
    by: ['tradeDate'],
    where: { tradeDate: { gte: startDate, lte: endDate } },
  });
  const beginsLate = aggregate._min.tradeDate != null && aggregate._min.tradeDate > startDate;

  return {
    id: 'top-list-coverage',
    title: 'Dragon-Tiger List: event coverage',
    status: beginsLate ? 'warn' : 'pass',
    summary: `${aggregate._count._all} events on ${activeDates.length} trading days`,
    details: [
      `Observed ${aggregate._min.tradeDate ?? 'n/a'}..${aggregate._max.tradeDate ?? 'n/a'}; empty dates are valid because this is a sparse event table.`,
      ...(beginsLate
        ? [
            `History begins after the audit scope start ${startDate}; older event coverage is absent.`,
          ]
        : []),
    ],
  };
}

async function auditKeyNullRates(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  // Two table-local aggregate scans are materially cheaper than a nullable-field LEFT JOIN across
  // more than ten million rows, while still exposing both field null rates and table-level coverage.
  const rows = await database.$queryRaw<NullCountRow[]>`
    SELECT
      'daily' AS source,
      COUNT(*) AS total,
      SUM(CASE WHEN d.close IS NULL THEN 1 ELSE 0 END) AS closeMissing,
      SUM(CASE WHEN d.amount IS NULL THEN 1 ELSE 0 END) AS amountMissing,
      0 AS pbMissing,
      0 AS totalMvMissing,
      0 AS circMvMissing,
      0 AS turnoverRateMissing,
      0 AS turnoverRateFMissing
    FROM Daily d
    WHERE d.tradeDate >= ${startDate} AND d.tradeDate <= ${endDate}
    UNION ALL
    SELECT
      'dailyBasic' AS source,
      COUNT(*) AS total,
      0 AS closeMissing,
      0 AS amountMissing,
      SUM(CASE WHEN b.pb IS NULL THEN 1 ELSE 0 END) AS pbMissing,
      SUM(CASE WHEN b.totalMv IS NULL THEN 1 ELSE 0 END) AS totalMvMissing,
      SUM(CASE WHEN b.circMv IS NULL THEN 1 ELSE 0 END) AS circMvMissing,
      SUM(CASE WHEN b.turnoverRate IS NULL THEN 1 ELSE 0 END) AS turnoverRateMissing,
      SUM(CASE WHEN b.turnoverRateF IS NULL THEN 1 ELSE 0 END) AS turnoverRateFMissing
    FROM DailyBasic b
    WHERE b.tradeDate >= ${startDate} AND b.tradeDate <= ${endDate}
  `;
  const dailyRow = rows.find((row) => row.source === 'daily');
  const dailyBasicRow = rows.find((row) => row.source === 'dailyBasic');
  const dailyTotal = toNumber(dailyRow?.total);
  const dailyBasicTotal = toNumber(dailyBasicRow?.total);
  const metrics = [
    ['Daily.close', toNumber(dailyRow?.closeMissing), dailyTotal],
    ['Daily.amount', toNumber(dailyRow?.amountMissing), dailyTotal],
    ['DailyBasic.pb', toNumber(dailyBasicRow?.pbMissing), dailyBasicTotal],
    ['DailyBasic.totalMv', toNumber(dailyBasicRow?.totalMvMissing), dailyBasicTotal],
    ['DailyBasic.circMv', toNumber(dailyBasicRow?.circMvMissing), dailyBasicTotal],
    ['DailyBasic.turnoverRate', toNumber(dailyBasicRow?.turnoverRateMissing), dailyBasicTotal],
    ['DailyBasic.turnoverRateF', toNumber(dailyBasicRow?.turnoverRateFMissing), dailyBasicTotal],
  ] as const;
  const maximumMissingFraction = Math.max(
    ...metrics.map(([, missing, total]) => (total > 0 ? missing / total : 1)),
  );
  const dailyBasicCoverage = dailyTotal > 0 ? dailyBasicTotal / dailyTotal : 0;
  const status: AuditStatus =
    maximumMissingFraction > 0.2 || dailyBasicCoverage < 0.8
      ? 'error'
      : maximumMissingFraction > 0.05 || dailyBasicCoverage < 0.95
        ? 'warn'
        : 'pass';

  return {
    id: 'key-null-rates',
    title: 'Daily bars and valuation: key null rates',
    status,
    summary: `${formatPercent(maximumMissingFraction)} maximum field missing rate; DailyBasic has ${formatPercent(dailyBasicCoverage)} as many rows as Daily`,
    details: [
      `Daily rows: ${formatNumber(dailyTotal)}; DailyBasic rows: ${formatNumber(dailyBasicTotal)}.`,
      ...metrics.map(
        ([name, missing, total]) =>
          `${name}: ${formatNumber(missing)} missing (${formatPercent(total > 0 ? missing / total : 1)}).`,
      ),
    ],
  };
}

async function auditAdjustmentJumps(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  // The window function uses the primary-key order (stock, date). This is a measured audit-only hot
  // path where loading every adjustment row through the ORM would use far more memory.
  const rows = await database.$queryRaw<AdjustmentJumpRow[]>`
    WITH ordered AS (
      SELECT
        tsCode,
        tradeDate,
        adjFactor,
        LAG(adjFactor) OVER (PARTITION BY tsCode ORDER BY tradeDate) AS previousFactor
      FROM AdjFactor
      WHERE tradeDate >= ${startDate} AND tradeDate <= ${endDate}
    ),
    suspicious AS (
      SELECT
        ordered.tsCode,
        ordered.tradeDate,
        ordered.previousFactor,
        ordered.adjFactor,
        ABS(ordered.adjFactor / ordered.previousFactor - 1.0) AS changeFraction
      FROM ordered
      WHERE ordered.previousFactor > 0
        AND ABS(ordered.adjFactor / ordered.previousFactor - 1.0) > 0.2
        AND NOT EXISTS (
          SELECT 1
          FROM Dividend
          WHERE Dividend.tsCode = ordered.tsCode
            AND Dividend.exDate = ordered.tradeDate
            AND Dividend.divProc = '实施'
        )
    )
    SELECT
      tsCode,
      tradeDate,
      previousFactor,
      adjFactor,
      changeFraction,
      COUNT(*) OVER () AS totalCount
    FROM suspicious
    ORDER BY changeFraction DESC
    LIMIT 20
  `;
  const totalCount = toNumber(rows[0]?.totalCount);

  return {
    id: 'adjustment-jumps',
    title: 'Adjustment factors: unexplained jumps',
    status: totalCount > 0 ? 'warn' : 'pass',
    summary:
      totalCount > 0
        ? `${totalCount} jumps above 20% without a same-day implemented dividend`
        : 'No unexplained jumps above 20%',
    details:
      rows.length > 0
        ? rows.map(
            (row) =>
              `${row.tsCode} ${row.tradeDate}: ${formatNumber(row.previousFactor, 4)} → ${formatNumber(row.adjFactor, 4)} (${formatPercent(row.changeFraction)}).`,
          )
        : ['Implemented-dividend dates are excluded before classifying a jump as suspicious.'],
  };
}

async function auditStockUniverse(database: Prisma): Promise<AuditFinding> {
  const [statusRows, coverageRows] = await Promise.all([
    database.$queryRaw<StockMasterRow[]>`
      SELECT listStatus, COUNT(*) AS count
      FROM StockBasic
      GROUP BY listStatus
      ORDER BY listStatus
    `,
    database.$queryRaw<StockCoverageRow[]>`
      SELECT
        COUNT(DISTINCT d.tsCode) AS dailyCodes,
        COUNT(DISTINCT CASE WHEN b.tsCode IS NULL AND c.oldTsCode IS NULL THEN d.tsCode END)
          AS unexplainedOrphanCodes,
        COUNT(DISTINCT CASE WHEN c.oldTsCode IS NOT NULL THEN d.tsCode END) AS aliasedDailyCodes
      FROM Daily d
      LEFT JOIN StockBasic b ON b.tsCode = d.tsCode
      LEFT JOIN StockCodeChange c ON c.oldTsCode = d.tsCode
    `,
  ]);
  const counts = new Map(statusRows.map((row) => [row.listStatus, toNumber(row.count)]));
  const delistedCount = counts.get('D') ?? 0;
  const unexplainedOrphanCodes = toNumber(coverageRows[0]?.unexplainedOrphanCodes);
  const aliasedDailyCodes = toNumber(coverageRows[0]?.aliasedDailyCodes);
  const dailyCodes = toNumber(coverageRows[0]?.dailyCodes);
  const hasSurvivorshipRisk =
    delistedCount === 0 || unexplainedOrphanCodes > 0 || aliasedDailyCodes > 0;

  return {
    id: 'stock-universe-survivorship',
    title: 'Stock universe: delisted coverage',
    status: hasSurvivorshipRisk ? 'error' : 'pass',
    summary: `${delistedCount} delisted instruments; ${unexplainedOrphanCodes} unexplained and ${aliasedDailyCodes} non-canonical of ${dailyCodes} Daily codes`,
    details: [
      `StockBasic status counts: ${statusRows.map((row) => `${row.listStatus}=${toNumber(row.count)}`).join(', ') || 'empty'}.`,
      ...(delistedCount === 0
        ? [
            'No delisted instruments are retained in StockBasic; a universe built from this table alone has survivorship risk.',
          ]
        : []),
      ...(unexplainedOrphanCodes > 0
        ? [
            `${unexplainedOrphanCodes} historical price codes cannot be explained by StockBasic or StockCodeChange.`,
          ]
        : []),
      ...(aliasedDailyCodes > 0
        ? [
            `${aliasedDailyCodes} superseded codes remain in Daily and can duplicate a security in cross-sectional analysis.`,
          ]
        : []),
    ],
  };
}

async function auditHistoricalInvestability(database: Prisma): Promise<AuditFinding> {
  const [summaryRows, overlapRows, openDuplicateRows, currentMissingRows] = await Promise.all([
    database.$queryRaw<
      Array<{
        spells: bigint | number;
        codes: bigint | number;
        riskSpells: bigint | number;
        delistingSpells: bigint | number;
      }>
    >`
      SELECT
        COUNT(*) AS spells,
        COUNT(DISTINCT tsCode) AS codes,
        SUM(CASE
          WHEN name LIKE 'ST%' OR name LIKE '*ST%' OR name LIKE 'SST%'
            OR name LIKE 'S*ST%' OR name LIKE 'PT%'
          THEN 1 ELSE 0 END) AS riskSpells,
        SUM(CASE WHEN name LIKE '%退' OR name LIKE '退市%' THEN 1 ELSE 0 END) AS delistingSpells
      FROM StockNameHistory
    `,
    database.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*) AS count
      FROM StockNameHistory earlier
      JOIN StockNameHistory later
        ON later.tsCode = earlier.tsCode
       AND later.startDate > earlier.startDate
       AND (earlier.endDate IS NULL OR later.startDate <= earlier.endDate)
    `,
    database.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*) AS count
      FROM (
        SELECT tsCode
        FROM StockNameHistory
        WHERE endDate IS NULL
        GROUP BY tsCode
        HAVING COUNT(*) > 1
      )
    `,
    database.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*) AS count
      FROM StockBasic basic
      WHERE basic.listStatus = 'L'
        AND NOT EXISTS (
          SELECT 1
          FROM StockNameHistory history
          WHERE history.tsCode = basic.tsCode
            AND history.endDate IS NULL
        )
    `,
  ]);
  const summary = summaryRows[0];
  const spells = toNumber(summary?.spells);
  const codes = toNumber(summary?.codes);
  const riskSpells = toNumber(summary?.riskSpells);
  const delistingSpells = toNumber(summary?.delistingSpells);
  const overlaps = toNumber(overlapRows[0]?.count);
  const duplicateOpenSpells = toNumber(openDuplicateRows[0]?.count);
  const listedMissingOpenSpell = toNumber(currentMissingRows[0]?.count);
  const status: AuditStatus =
    spells === 0 || overlaps > 0 || duplicateOpenSpells > 0
      ? 'error'
      : listedMissingOpenSpell > 0
        ? 'warn'
        : 'pass';

  return {
    id: 'historical-investability',
    title: 'Historical investability status',
    status,
    summary: `${formatNumber(spells)} name spells across ${formatNumber(codes)} codes; ${overlaps} overlaps; ${listedMissingOpenSpell} listed codes lack an open spell`,
    details: [
      `${formatNumber(riskSpells)} risk-warning spells and ${formatNumber(delistingSpells)} delisting-period spells are derivable point-in-time.`,
      `${duplicateOpenSpells} codes have more than one open-ended name spell.`,
      'Historical filters must use the name spell covering the evaluated date, never the current StockBasic name.',
    ],
  };
}

async function auditWindowCoverage(
  database: Prisma,
  openDates: string[],
  windowTradingDays: number,
  evaluationPoints: number,
): Promise<AuditFinding> {
  const evaluationDates = selectEvaluationDates(openDates, evaluationPoints);
  const summaries = (
    await Promise.all(
      evaluationDates.map(async (evaluationDate): Promise<WindowCoverageSummary | null> => {
        const endIndex = openDates.indexOf(evaluationDate);
        const startIndex = Math.max(0, endIndex - windowTradingDays + 1);
        const windowDates = openDates.slice(startIndex, endIndex + 1);
        if (windowDates.length < windowTradingDays) {
          return null;
        }
        const windowStart = windowDates[0];
        const rows = await database.$queryRaw<WindowCoverageRow[]>`
          SELECT d.tsCode, COUNT(d.close) AS observedDays
          FROM Daily d
          WHERE d.tradeDate >= ${windowStart}
            AND d.tradeDate <= ${evaluationDate}
            AND EXISTS (
              SELECT 1
              FROM Daily history
              WHERE history.tsCode = d.tsCode
                AND history.tradeDate < ${windowStart}
              LIMIT 1
            )
          GROUP BY d.tsCode
        `;
        return summarizeWindowCoverage(evaluationDate, windowStart, windowTradingDays, rows);
      }),
    )
  ).filter((summary): summary is WindowCoverageSummary => summary != null);

  const totalEligible = summaries.reduce((sum, summary) => sum + summary.eligibleStocks, 0);
  const totalBelow = summaries.reduce((sum, summary) => sum + summary.belowMinimumCount, 0);
  const hasWeakEvaluationPoint = summaries.some(
    (summary) =>
      summary.tenthPercentileCoverage < MINIMUM_WINDOW_COVERAGE ||
      summary.belowMinimumCount / summary.eligibleStocks > 0.05,
  );
  const status: AuditStatus =
    totalEligible === 0 ? 'error' : hasWeakEvaluationPoint ? 'warn' : 'pass';

  return {
    id: 'window-coverage',
    title: `Price windows: ${windowTradingDays}-day observation coverage`,
    status,
    summary: `${formatNumber(totalBelow)} of ${formatNumber(totalEligible)} eligible stock-windows fall below ${formatPercent(MINIMUM_WINDOW_COVERAGE)}`,
    details: summaries.map(
      (summary) =>
        `${summary.evaluationDate} (${summary.windowStart}..${summary.evaluationDate}): n=${summary.eligibleStocks}, median=${formatPercent(summary.medianCoverage)}, p10=${formatPercent(summary.tenthPercentileCoverage)}, below=${summary.belowMinimumCount}.`,
    ),
  };
}

async function auditFinancialPit(database: Prisma): Promise<AuditFinding> {
  const rows = await database.$queryRaw<FinancialPitRow[]>`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN annDate IS NULL THEN 1 ELSE 0 END) AS missingAnnouncementDate,
      SUM(CASE WHEN annDate < endDate THEN 1 ELSE 0 END) AS announcementBeforePeriodEnd
    FROM FinaIndicator
  `;
  const row = rows[0];
  const total = toNumber(row?.total);
  const missingAnnouncementDate = toNumber(row?.missingAnnouncementDate);
  const announcementBeforePeriodEnd = toNumber(row?.announcementBeforePeriodEnd);
  const status: AuditStatus =
    announcementBeforePeriodEnd > 0 ? 'error' : missingAnnouncementDate > 0 ? 'warn' : 'pass';

  return {
    id: 'financial-pit',
    title: 'Financial indicators: point-in-time gate',
    status,
    summary: `${missingAnnouncementDate} missing announcement dates; ${announcementBeforePeriodEnd} announcements before report-period end`,
    details: [
      `${formatNumber(total)} FinaIndicator rows checked.`,
      'The required invariant is annDate >= endDate; analysis must gate availability on annDate.',
    ],
  };
}

async function auditFinancialStatementVersions(database: Prisma): Promise<AuditFinding> {
  const [versionRows, reconciliationRows] = await Promise.all([
    database.$queryRaw<FinancialStatementVersionAuditRow[]>`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN announcementDate < endDate THEN 1 ELSE 0 END) AS invalidAnnouncementDate,
        SUM(CASE WHEN availableDate <= announcementDate THEN 1 ELSE 0 END) AS invalidAvailableDate,
        SUM(CASE WHEN availabilityQuality NOT IN ('exact', 'conservative', 'reconstructed') THEN 1 ELSE 0 END) AS invalidQuality,
        SUM(CASE WHEN reportType NOT IN ('1', '4', '5') OR compType <> '1' THEN 1 ELSE 0 END) AS invalidReportScope
      FROM (
        SELECT announcementDate, availableDate, availabilityQuality, reportType, compType
        FROM FinancialIncomeStatement
        UNION ALL
        SELECT announcementDate, availableDate, availabilityQuality, reportType, compType
        FROM FinancialBalanceSheet
        UNION ALL
        SELECT announcementDate, availableDate, availabilityQuality, reportType, compType
        FROM FinancialCashFlowStatement
      )
    `,
    database.$queryRaw<FinancialStatementReconciliationRow[]>`
      SELECT
        COUNT(*) AS indicatorPeriods,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM FinancialIncomeStatement statement
          WHERE statement.tsCode = indicator.tsCode AND statement.endDate = indicator.endDate
        ) THEN 1 ELSE 0 END) AS incomeMatches,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM FinancialBalanceSheet statement
          WHERE statement.tsCode = indicator.tsCode AND statement.endDate = indicator.endDate
        ) THEN 1 ELSE 0 END) AS balanceMatches,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM FinancialCashFlowStatement statement
          WHERE statement.tsCode = indicator.tsCode AND statement.endDate = indicator.endDate
        ) THEN 1 ELSE 0 END) AS cashFlowMatches
      FROM FinaIndicator indicator
    `,
  ]);
  return summarizeFinancialStatementVersions(versionRows[0], reconciliationRows[0]);
}

export async function auditFinancialStatementAccounting(database: Prisma): Promise<AuditFinding> {
  const [balanceRows, cashRows, crossRows, coverageRows] = await Promise.all([
    database.$queryRaw<FinancialAccountingIdentityAuditRow[]>`
      SELECT
        SUM(CASE WHEN totalAssets IS NOT NULL AND totalLiab IS NOT NULL
          AND totalHldrEqyExcMinInt IS NOT NULL THEN 1 ELSE 0 END) AS comparable,
        SUM(CASE WHEN totalAssets IS NOT NULL AND totalLiab IS NOT NULL
          AND totalHldrEqyExcMinInt IS NOT NULL
          AND ABS(totalAssets - totalLiab - totalHldrEqyExcMinInt - COALESCE(minorityInt, 0))
            > MAX(1.0, ABS(totalAssets) * 0.000001) THEN 1 ELSE 0 END) AS mismatches,
        SUM(CASE WHEN totalAssets <= 0 OR totalLiab < 0 OR totalShare <= 0
          OR totalCurAssets > totalAssets OR totalCurLiab > totalLiab THEN 1 ELSE 0 END) AS anomalies
      FROM FinancialBalanceSheet
    `,
    database.$queryRaw<FinancialAccountingIdentityAuditRow[]>`
      SELECT
        SUM(CASE WHEN cCashEquBegPeriod IS NOT NULL AND nIncrCashCashEqu IS NOT NULL
          AND cCashEquEndPeriod IS NOT NULL THEN 1 ELSE 0 END) AS comparable,
        SUM(CASE WHEN cCashEquBegPeriod IS NOT NULL AND nIncrCashCashEqu IS NOT NULL
          AND cCashEquEndPeriod IS NOT NULL
          AND ABS(cCashEquBegPeriod + nIncrCashCashEqu - cCashEquEndPeriod)
            > MAX(1.0, ABS(cCashEquEndPeriod) * 0.000001) THEN 1 ELSE 0 END) AS mismatches,
        SUM(CASE WHEN cPayAcqConstFiolta < 0 THEN 1 ELSE 0 END) AS anomalies
      FROM FinancialCashFlowStatement
    `,
    database.$queryRaw<FinancialAccountingIdentityAuditRow[]>`
      SELECT
        COUNT(*) AS comparable,
        SUM(CASE WHEN ABS(income.nIncome - cash.netProfit)
          > MAX(1.0, MAX(ABS(income.nIncome), ABS(cash.netProfit)) * 0.000001)
          THEN 1 ELSE 0 END) AS mismatches,
        0 AS anomalies
      FROM FinancialIncomeStatement income
      JOIN FinancialCashFlowStatement cash
        ON cash.tsCode = income.tsCode
        AND cash.endDate = income.endDate
        AND cash.reportType = income.reportType
        AND cash.availableDate = income.availableDate
      WHERE income.availabilityQuality <> 'reconstructed'
        AND cash.availabilityQuality <> 'reconstructed'
        AND income.nIncome IS NOT NULL
        AND cash.netProfit IS NOT NULL
    `,
    database.$queryRaw<FinancialMetricCoverageAuditRow[]>`
      WITH periods AS (
        SELECT tsCode, endDate FROM FinancialIncomeStatement
        WHERE availabilityQuality <> 'reconstructed'
        UNION
        SELECT tsCode, endDate FROM FinancialBalanceSheet
        WHERE availabilityQuality <> 'reconstructed'
        UNION
        SELECT tsCode, endDate FROM FinancialCashFlowStatement
        WHERE availabilityQuality <> 'reconstructed'
      )
      SELECT
        COUNT(*) AS totalPeriods,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM FinancialIncomeStatement income
          WHERE income.tsCode = periods.tsCode AND income.endDate = periods.endDate
            AND income.availabilityQuality <> 'reconstructed'
        ) AND EXISTS (
          SELECT 1 FROM FinancialBalanceSheet balance
          WHERE balance.tsCode = periods.tsCode AND balance.endDate = periods.endDate
            AND balance.availabilityQuality <> 'reconstructed'
        ) AND EXISTS (
          SELECT 1 FROM FinancialCashFlowStatement cash
          WHERE cash.tsCode = periods.tsCode AND cash.endDate = periods.endDate
            AND cash.availabilityQuality <> 'reconstructed'
        ) THEN 1 ELSE 0 END) AS completePeriods
      FROM periods
    `,
  ]);
  return summarizeFinancialStatementAccounting(
    balanceRows[0],
    cashRows[0],
    crossRows[0],
    coverageRows[0],
  );
}

export function summarizeFinancialStatementVersions(
  versions: FinancialStatementVersionAuditRow | undefined,
  reconciliation: FinancialStatementReconciliationRow | undefined,
): AuditFinding {
  const total = toNumber(versions?.total);
  const invalidAnnouncementDate = toNumber(versions?.invalidAnnouncementDate);
  const invalidAvailableDate = toNumber(versions?.invalidAvailableDate);
  const invalidQuality = toNumber(versions?.invalidQuality);
  const invalidReportScope = toNumber(versions?.invalidReportScope);
  const invalidRows =
    invalidAnnouncementDate + invalidAvailableDate + invalidQuality + invalidReportScope;
  const indicatorPeriods = toNumber(reconciliation?.indicatorPeriods);
  const matches = {
    income: toNumber(reconciliation?.incomeMatches),
    balance: toNumber(reconciliation?.balanceMatches),
    cashFlow: toNumber(reconciliation?.cashFlowMatches),
  };
  const minimumCoverage =
    indicatorPeriods > 0
      ? Math.min(matches.income, matches.balance, matches.cashFlow) / indicatorPeriods
      : 1;
  const status: AuditStatus =
    invalidRows > 0 ? 'error' : total === 0 || minimumCoverage < 0.8 ? 'warn' : 'pass';

  return {
    id: 'financial-statement-versions',
    title: 'Financial statements: append-only PIT versions',
    status,
    summary: `${formatNumber(total)} statement versions; ${formatNumber(invalidRows)} invalid PIT or scope fields; minimum legacy-period coverage ${formatPercent(minimumCoverage)}`,
    details: [
      `Invalid fields: announcement=${invalidAnnouncementDate}, availability=${invalidAvailableDate}, quality=${invalidQuality}, scope=${invalidReportScope}.`,
      `FinaIndicator reconciliation (${formatNumber(indicatorPeriods)} periods): income=${formatNumber(matches.income)}, balance=${formatNumber(matches.balance)}, cash flow=${formatNumber(matches.cashFlow)}.`,
      'FinaIndicator remains a compatibility source; these coverage counts do not overwrite either data path.',
    ],
  };
}

export function summarizeFinancialStatementAccounting(
  balance: FinancialAccountingIdentityAuditRow | undefined,
  cash: FinancialAccountingIdentityAuditRow | undefined,
  crossStatement: FinancialAccountingIdentityAuditRow | undefined,
  coverage: FinancialMetricCoverageAuditRow | undefined,
): AuditFinding {
  const comparable =
    toNumber(balance?.comparable) +
    toNumber(cash?.comparable) +
    toNumber(crossStatement?.comparable);
  const mismatches =
    toNumber(balance?.mismatches) +
    toNumber(cash?.mismatches) +
    toNumber(crossStatement?.mismatches);
  const anomalies =
    toNumber(balance?.anomalies) + toNumber(cash?.anomalies) + toNumber(crossStatement?.anomalies);
  const totalPeriods = toNumber(coverage?.totalPeriods);
  const completePeriods = toNumber(coverage?.completePeriods);
  const coverageRatio = totalPeriods > 0 ? completePeriods / totalPeriods : 0;
  const mismatchRatio = comparable > 0 ? mismatches / comparable : 0;
  const status: AuditStatus =
    anomalies > 0
      ? 'error'
      : totalPeriods === 0 || coverageRatio < 0.8 || mismatchRatio > 0.01
        ? 'warn'
        : 'pass';

  return {
    id: 'financial-statement-accounting',
    title: 'Financial statements: accounting consistency and metric coverage',
    status,
    summary: `${formatNumber(mismatches)} of ${formatNumber(comparable)} comparable identities mismatch; ${formatPercent(coverageRatio)} three-statement coverage`,
    details: [
      `Balance identity: ${formatNumber(toNumber(balance?.mismatches))}/${formatNumber(toNumber(balance?.comparable))} mismatches.`,
      `Cash identity: ${formatNumber(toNumber(cash?.mismatches))}/${formatNumber(toNumber(cash?.comparable))} mismatches.`,
      `Cross-statement net income: ${formatNumber(toNumber(crossStatement?.mismatches))}/${formatNumber(toNumber(crossStatement?.comparable))} mismatches.`,
      `${formatNumber(anomalies)} impossible sign or subtotal relationships; ${formatNumber(completePeriods)}/${formatNumber(totalPeriods)} strict-PIT periods have all three statements.`,
      'Derived metrics still return explicit missing or invalid reasons when required quarters or fields are unavailable.',
    ],
  };
}

async function auditMacroPit(database: Prisma): Promise<AuditFinding> {
  const observations = await database.macroObservation.findMany({
    select: {
      seriesKey: true,
      period: true,
      releaseDate: true,
      availableDate: true,
      availabilityKind: true,
      vintageKind: true,
    },
  });
  const observedSeries = [...new Set(observations.map((row) => row.seriesKey))];
  const availableDates = observations.map((row) => row.availableDate).sort();
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
  const summary = summarizeMacroPit(
    observedSeries,
    observations,
    new Set(calendarRows.map((row) => row.calDate)),
  );
  const hasBrokenInvariant =
    summary.missingSeries.length > 0 ||
    summary.invalidAvailabilityRows > 0 ||
    summary.nonTradingAvailabilityRows > 0;
  const hasEstimatedHistory =
    summary.conservativeLagRows > 0 || summary.latestValueBackfillRows > 0;
  const status: AuditStatus = hasBrokenInvariant ? 'error' : hasEstimatedHistory ? 'warn' : 'pass';

  return {
    id: 'macro-pit',
    title: 'Macro observations: point-in-time availability',
    status,
    summary: `${formatNumber(observations.length)} vintages; ${summary.invalidAvailabilityRows} invalid availability rows; ${summary.nonTradingAvailabilityRows} non-trading availability dates`,
    details: [
      `Missing required series: ${summary.missingSeries.length === 0 ? 'none' : summary.missingSeries.join(', ')}.`,
      `${formatNumber(summary.conservativeLagRows)} rows use conservative release lags; ${formatNumber(summary.latestValueBackfillRows)} rows are latest-value historical backfills.`,
      `${formatNumber(summary.capturedAsAvailableRows)} rows were captured near their original availability date.`,
      'Latest-value backfills are suitable for exploratory research only and must not be presented as real-time vintages.',
    ],
  };
}

async function auditExternalMarketPit(database: Prisma, endDate: string): Promise<AuditFinding> {
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

async function auditCrossMarketBenchmarkPit(
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

async function auditCreditCurvePit(database: Prisma, endDate: string): Promise<AuditFinding> {
  const curveCodes = CHINABOND_PUBLIC_CURVES.map((curve) => curve.curveCode);
  const curveRows = await database.yieldCurvePoint.findMany({
    where: { curveCode: { in: curveCodes }, termYears: 5 },
    select: {
      curveCode: true,
      tradeDate: true,
      availableDate: true,
      yieldPct: true,
    },
  });
  const rows: ExternalMarketPitAuditRow[] = curveRows.map((row) => ({
    seriesKey: row.curveCode,
    tradeDate: row.tradeDate,
    availableDate: row.availableDate,
    validValue: Number.isFinite(row.yieldPct) && row.yieldPct > -10 && row.yieldPct < 30,
  }));
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
  const summary = summarizeCreditCurvePit(
    rows,
    new Set(calendarRows.map((row) => row.calDate)),
    endDate,
  );
  const broken =
    summary.missingSeries.length > 0 ||
    summary.invalidAvailabilityRows > 0 ||
    summary.nonTradingAvailabilityRows > 0 ||
    summary.invalidValueRows > 0;

  return {
    id: 'credit-curve-pit',
    title: 'China credit curves: coverage and point-in-time availability',
    status: broken ? 'error' : summary.staleSeries.length > 0 ? 'warn' : 'pass',
    summary: `${formatNumber(rows.length)} 5Y observations; ${summary.invalidAvailabilityRows} invalid availability rows; ${summary.nonTradingAvailabilityRows} non-trading availability dates`,
    details: [
      `Missing required curves: ${summary.missingSeries.length === 0 ? 'none' : summary.missingSeries.join(', ')}.`,
      `Stale required curves: ${summary.staleSeries.length === 0 ? 'none' : summary.staleSeries.join(', ')}.`,
      `${summary.invalidValueRows} rows have invalid yields; latest China-market availability is ${summary.latestAvailableDate ?? 'none'}.`,
      'ChinaBond curves publish after the China close and must use the first strictly later SSE session; credit spreads require exact same-date, same-term subtraction with no interpolation.',
    ],
  };
}

async function auditCommodityWarehouseReceiptPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditCommodityWarehouseReceipts(
    { startDate, endDate, maximumLagTradingDays: 3 },
    database,
  );

  return {
    id: 'commodity-warehouse-receipt-pit',
    title: 'Commodity warehouse receipts: coverage and point-in-time availability',
    status: summary.status,
    summary: `${formatNumber(summary.rows)} rows; ${summary.invalidRows} invalid; ${summary.errors.length} errors and ${summary.warnings.length} warnings`,
    details: [
      ...summary.products.map(
        (product) =>
          `${product.productCode}: ${formatNumber(product.rows)} rows, latest ${product.latestTradeDate ?? 'n/a'}, available ${product.latestAvailableDate ?? 'n/a'}, lag ${product.lagTradingDays ?? 'n/a'} trading days, units ${product.units.join('/') || 'n/a'}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'Absolute levels remain product- and unit-specific; SC barrel and tonne series must never be added without a documented conversion.',
    ],
  };
}

async function auditCommodityHoldingPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditCommodityHoldingPositions({ startDate, endDate }, database);
  return {
    id: 'commodity-holding-pit',
    title: 'Commodity ranked-member positions: coverage and point-in-time availability',
    status: summary.status,
    summary: `${formatNumber(summary.rows)} product-days; ${summary.invalidRows} invalid; ${summary.errors.length} errors and ${summary.warnings.length} warnings`,
    details: [
      ...summary.products.map(
        (product) =>
          `${product.productCode}: ${formatNumber(product.observedDates)}/${formatNumber(product.expectedDates)} representative-contract dates (${formatPercent(product.coverage)}), latest ${product.latestObservedDate ?? 'n/a'}, trailing gaps ${product.trailingMissingDates}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'The stored long/short values aggregate exchange ranking subsets for the maximum-open-interest actual contract; they are not whole-market positions or a trader classification.',
      'SC is excluded because repeated Tushare INE probes returned empty; no proxy is substituted.',
    ],
  };
}

async function auditCommodityContinuousReturnPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditCommodityContinuousReturns({ startDate, endDate }, database);
  return {
    id: 'commodity-continuous-return-pit',
    title: 'Commodity main-contract returns: mapping, roll decomposition, and PIT',
    status: summary.status,
    summary: `${formatNumber(summary.rows)} return rows; ${summary.invalidRows} invalid; ${summary.errors.length} errors and ${summary.warnings.length} warnings`,
    details: [
      ...summary.products.map(
        (product) =>
          `${product.productCode}: mappings ${formatNumber(product.mappingDates)}/${formatNumber(product.expectedOpenDates)} (${formatPercent(product.mappingCoverage)}), return source ${formatPercent(product.returnSourceCoverage)}, ${product.rollDays} mapped roll days, latest ${product.latestReturnDate ?? 'n/a'}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'The continuous return uses the current mapped contract at both interval endpoints. The separately stored roll gap is a code-switch basis; rollYieldProxy is explanatory and is not realized daily P&L.',
    ],
  };
}

async function auditMarketRiskDriverPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditMarketRiskDrivers({ startDate, endDate }, database);
  return {
    id: 'market-risk-driver-readiness',
    title: 'Daily market-risk drivers: complete-vector PIT readiness',
    status: summary.status,
    summary: `${formatNumber(summary.completeObservations)}/${formatNumber(summary.expectedDates)} complete SSE sessions (${formatPercent(summary.completeCoverage)}); latest ${summary.latestCompleteDate ?? 'n/a'}`,
    details: [
      ...summary.factors.map(
        (factor) =>
          `${factor.factor}: ${formatNumber(factor.observations)} observations, latest ${factor.latestDate ?? 'n/a'}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'Daily market-risk vectors remain separate from monthly macro axes. Missing drivers remove the date from multivariate estimation; no factor is filled with zero.',
    ],
  };
}

async function auditMacroRiskAxisPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditMacroRiskAxes({ startDate, endDate }, database);
  return {
    id: 'macro-risk-axis-readiness',
    title: 'Monthly macro-risk axes: exploratory and strict-PIT readiness',
    status: summary.status,
    summary: `${formatNumber(summary.exploratoryCompleteObservations)} exploratory and ${formatNumber(summary.strictCompleteObservations)} strict-PIT complete months; latest ${summary.latestExploratoryCompleteDate ?? 'n/a'}`,
    details: [
      ...summary.axes.map(
        (axis) =>
          `${axis.axis}: ${formatNumber(axis.exploratoryObservations)} exploratory changes, ${formatNumber(axis.strictObservations)} strict-PIT changes, latest ${axis.latestExploratoryDate ?? 'n/a'}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'Growth, inflation, liquidity, credit, and external-pressure score changes are monthly and remain separate from the daily market-risk covariance model.',
      'Latest-vintage history supports exploration only. Macro sensitivity becomes publishable only after enough locally captured as-available vintages accumulate.',
    ],
  };
}

function appendDateList(details: string[], label: string, dates: string[]): void {
  if (dates.length === 0) {
    return;
  }
  details.push(
    `${label}: ${dates.length} (${dates.slice(0, 10).join(', ')}${dates.length > 10 ? ', …' : ''}).`,
  );
}

function toNumber(value: bigint | number | null | undefined): number {
  if (value == null) {
    return 0;
  }
  return typeof value === 'bigint' ? Number(value) : value;
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
