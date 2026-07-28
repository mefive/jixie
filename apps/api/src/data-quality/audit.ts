import { median, quantile } from '../lib/stats.js';
import type { Prisma } from '../lib/prisma.js';

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

interface WindowCoverageRow {
  tsCode: string;
  observedDays: bigint | number;
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
    await auditWindowCoverage(database, openDates, windowTradingDays, evaluationPoints),
    await auditFinancialPit(database),
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
  const [daily, adjFactor, dailyBasic, moneyflow, stkLimit] = await Promise.all([
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
  ]);
  const normalize = (rows: Array<{ tradeDate: string; _count: { _all: number } }>) =>
    rows.map((row) => ({ tradeDate: row.tradeDate, count: row._count._all }));

  return {
    daily: normalize(daily),
    'adj-factor': normalize(adjFactor),
    'daily-basic': normalize(dailyBasic),
    moneyflow: normalize(moneyflow),
    'stk-limit': normalize(stkLimit),
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
