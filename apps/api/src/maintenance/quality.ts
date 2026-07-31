import {
  MARKET_STATE_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
  MAJOR_INDEX_DAILY_CODES,
} from '../store/index-presets.js';
import { prisma } from '../lib/prisma.js';

export interface RawDateQuality {
  tradeDate: string;
  daily: number;
  adjustmentCoverage: number;
  basicCoverage: number;
  limitCoverage: number;
  moneyflowCoverage: number;
  indexDaily: number;
  indexDailyBasic: number;
  oldestIndexWeightSnapshot: string;
  activeIndustries: number;
}

export interface DerivedRangeQuality {
  startDate: string;
  endDate: string;
  marketDates: number;
  indexRows: number;
  industryRows: number;
}

interface CoverageRow {
  daily: bigint | number;
  adjustmentMatches: bigint | number;
  basicMatches: bigint | number;
  limitMatches: bigint | number;
  moneyflowMatches: bigint | number;
  aliasedCodes: bigint | number;
}

export async function validateRawMarketDate(tradeDate: string): Promise<RawDateQuality> {
  const [coverageRows, indexCodes, indexBasicCodes, activeIndustries, indexSnapshots] =
    await Promise.all([
      prisma.$queryRaw<CoverageRow[]>`
      SELECT
        COUNT(*) AS daily,
        SUM(CASE WHEN a.tsCode IS NOT NULL THEN 1 ELSE 0 END) AS adjustmentMatches,
        SUM(CASE WHEN b.tsCode IS NOT NULL THEN 1 ELSE 0 END) AS basicMatches,
        SUM(CASE WHEN l.tsCode IS NOT NULL THEN 1 ELSE 0 END) AS limitMatches,
        SUM(CASE WHEN m.tsCode IS NOT NULL THEN 1 ELSE 0 END) AS moneyflowMatches,
        SUM(CASE WHEN c.oldTsCode IS NOT NULL THEN 1 ELSE 0 END) AS aliasedCodes
      FROM Daily d
      LEFT JOIN AdjFactor a ON a.tsCode = d.tsCode AND a.tradeDate = d.tradeDate
      LEFT JOIN DailyBasic b ON b.tsCode = d.tsCode AND b.tradeDate = d.tradeDate
      LEFT JOIN StkLimit l ON l.tsCode = d.tsCode AND l.tradeDate = d.tradeDate
      LEFT JOIN Moneyflow m ON m.tsCode = d.tsCode AND m.tradeDate = d.tradeDate
      LEFT JOIN StockCodeChange c ON c.oldTsCode = d.tsCode
      WHERE d.tradeDate = ${tradeDate}
    `,
      prisma.indexDaily.findMany({
        where: { tradeDate, tsCode: { in: [...MAJOR_INDEX_DAILY_CODES] } },
        select: { tsCode: true },
      }),
      prisma.indexDailyBasic.findMany({
        where: { tradeDate, tsCode: { in: [...MAJOR_INDEX_DAILY_BASIC_CODES] } },
        select: { tsCode: true },
      }),
      prisma.swIndustryMember.groupBy({
        by: ['l1Code'],
        where: {
          inDate: { lte: tradeDate },
          OR: [{ outDate: null }, { outDate: { gt: tradeDate } }],
        },
      }),
      Promise.all(
        MARKET_STATE_INDEX_CODES.map((indexCode) =>
          prisma.indexWeight.findFirst({
            where: { indexCode, tradeDate: { lte: tradeDate } },
            orderBy: { tradeDate: 'desc' },
            select: { tradeDate: true },
          }),
        ),
      ),
    ]);
  const coverage = coverageRows[0];
  const daily = toNumber(coverage?.daily);
  if (daily === 0) {
    throw new Error(`Daily is empty for ${tradeDate}`);
  }

  const adjustmentCoverage = toNumber(coverage.adjustmentMatches) / daily;
  const basicCoverage = toNumber(coverage.basicMatches) / daily;
  const limitCoverage = toNumber(coverage.limitMatches) / daily;
  const moneyflowCoverage = toNumber(coverage.moneyflowMatches) / daily;
  if (
    adjustmentCoverage < 0.98 ||
    basicCoverage < 0.85 ||
    limitCoverage < 0.85 ||
    moneyflowCoverage < 0.7
  ) {
    throw new Error(
      `Core coverage failed for ${tradeDate}: adjustment=${percent(adjustmentCoverage)}, basic=${percent(basicCoverage)}, limits=${percent(limitCoverage)}, moneyflow=${percent(moneyflowCoverage)}`,
    );
  }
  if (toNumber(coverage.aliasedCodes) > 0) {
    throw new Error(`Superseded stock codes remain in Daily for ${tradeDate}`);
  }

  const actualIndexCodes = new Set(indexCodes.map((row) => row.tsCode));
  const missingIndexCodes = MAJOR_INDEX_DAILY_CODES.filter((code) => !actualIndexCodes.has(code));
  if (missingIndexCodes.length > 0) {
    throw new Error(`IndexDaily is missing ${missingIndexCodes.join(', ')} for ${tradeDate}`);
  }
  const actualIndexBasicCodes = new Set(indexBasicCodes.map((row) => row.tsCode));
  const missingIndexBasicCodes = MAJOR_INDEX_DAILY_BASIC_CODES.filter(
    (code) => !actualIndexBasicCodes.has(code),
  );
  if (missingIndexBasicCodes.length > 0) {
    throw new Error(
      `IndexDailyBasic is missing ${missingIndexBasicCodes.join(', ')} for ${tradeDate}`,
    );
  }
  const missingSnapshots = MARKET_STATE_INDEX_CODES.filter((_, index) => !indexSnapshots[index]);
  if (missingSnapshots.length > 0) {
    throw new Error(
      `IndexWeight has no point-in-time snapshot for ${missingSnapshots.join(', ')} by ${tradeDate}`,
    );
  }
  const maximumIndexWeightAgeDays = positiveInteger(
    process.env.MAINTENANCE_INDEX_WEIGHT_MAX_AGE_DAYS,
    190,
  );
  const oldestAllowedSnapshot = addCalendarDays(tradeDate, -maximumIndexWeightAgeDays);
  const staleSnapshots = MARKET_STATE_INDEX_CODES.filter((_, index) => {
    const snapshotDate = indexSnapshots[index]?.tradeDate;
    return snapshotDate != null && snapshotDate < oldestAllowedSnapshot;
  });
  if (staleSnapshots.length > 0) {
    throw new Error(
      `IndexWeight point-in-time snapshots are older than ${maximumIndexWeightAgeDays} days for ${staleSnapshots.join(', ')}`,
    );
  }
  if (activeIndustries.length < 20) {
    throw new Error(
      `Only ${activeIndustries.length} active Shenwan industries are available for ${tradeDate}`,
    );
  }

  return {
    tradeDate,
    daily,
    adjustmentCoverage,
    basicCoverage,
    limitCoverage,
    moneyflowCoverage,
    indexDaily: actualIndexCodes.size,
    indexDailyBasic: actualIndexBasicCodes.size,
    oldestIndexWeightSnapshot: indexSnapshots.map((snapshot) => snapshot!.tradeDate).sort()[0],
    activeIndustries: activeIndustries.length,
  };
}

export async function validateDerivedMarketRange(
  startDate: string,
  endDate: string,
  expectedDates: string[],
): Promise<DerivedRangeQuality> {
  const [marketRows, indexRows, industryRows] = await Promise.all([
    prisma.marketIndicator.findMany({
      where: { tradeDate: { gte: startDate, lte: endDate } },
      select: {
        tradeDate: true,
        advanceRatio: true,
        aboveMa20Ratio: true,
        aboveMa60Ratio: true,
      },
    }),
    prisma.indexIndicator.count({ where: { tradeDate: { gte: startDate, lte: endDate } } }),
    prisma.industryIndicator.count({ where: { tradeDate: { gte: startDate, lte: endDate } } }),
  ]);
  const marketByDate = new Map(marketRows.map((row) => [row.tradeDate, row]));
  const missingDates = expectedDates.filter((date) => !marketByDate.has(date));
  if (missingDates.length > 0) {
    throw new Error(`MarketIndicator is missing ${missingDates.join(', ')}`);
  }
  for (const row of marketRows) {
    for (const value of [row.advanceRatio, row.aboveMa20Ratio, row.aboveMa60Ratio]) {
      if (value != null && (value < 0 || value > 1)) {
        throw new Error(`MarketIndicator ratio is outside [0, 1] on ${row.tradeDate}`);
      }
    }
  }
  if (indexRows < expectedDates.length * MARKET_STATE_INDEX_CODES.length) {
    throw new Error(
      `IndexIndicator has ${indexRows} rows; expected at least ${expectedDates.length * MARKET_STATE_INDEX_CODES.length}`,
    );
  }
  if (industryRows < expectedDates.length * 20) {
    throw new Error(
      `IndustryIndicator has ${industryRows} rows; expected at least ${expectedDates.length * 20}`,
    );
  }

  return {
    startDate,
    endDate,
    marketDates: marketRows.length,
    indexRows,
    industryRows,
  };
}

function toNumber(value: bigint | number | undefined): number {
  return typeof value === 'bigint' ? Number(value) : (value ?? 0);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)) + days,
    ),
  );
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}
