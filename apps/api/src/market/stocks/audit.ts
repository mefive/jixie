import type { Prisma } from '#infra/database/prisma.js';
import { median, quantile } from '#math/stats.js';
import type { DateCount } from '../quality/coverage.js';
import { buildDenseCoverageFinding } from '../quality/coverage.js';
import { formatNumber, formatPercent, toNumber } from '../quality/format.js';
import type { AuditFinding, AuditStatus } from '../quality/report.js';

export interface NullCountRow {
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

export interface AdjustmentJumpRow {
  tsCode: string;
  tradeDate: string;
  previousFactor: number;
  adjFactor: number;
  changeFraction: number;
  totalCount: bigint | number;
}

export interface WindowCoverageRow {
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

export const MINIMUM_WINDOW_COVERAGE = 2 / 3;

export const DENSE_TABLES = [
  { id: 'daily', title: 'Daily bars' },
  { id: 'adj-factor', title: 'Adjustment factors' },
  { id: 'daily-basic', title: 'Daily valuation metrics' },
  { id: 'moneyflow', title: 'Daily money flow' },
  { id: 'stk-limit', title: 'Daily price limits' },
] as const;

export async function loadDenseDateCounts(
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

export async function auditSparseTopList(
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

export async function auditKeyNullRates(
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

export async function auditAdjustmentJumps(
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

export async function auditHistoricalInvestability(database: Prisma): Promise<AuditFinding> {
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

export async function auditWindowCoverage(
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

export async function auditStockCalendarCoverage(
  database: Prisma,
  startDate: string,
  endDate: string,
  openDates: string[],
): Promise<AuditFinding[]> {
  const counts = await loadDenseDateCounts(database, startDate, endDate);
  return DENSE_TABLES.map((table) =>
    buildDenseCoverageFinding(table.id, table.title, openDates, counts[table.id]),
  );
}
