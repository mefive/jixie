import { prisma } from '#infra/database/prisma.js';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
  MAJOR_INDEX_DAILY_CODES,
  MARKET_WEATHER_INDEX_CODES,
  MARKET_WEATHER_INDICATOR_INDEX_CODES,
} from '../registry/index-presets.js';

export interface IndexDateQuality {
  indexDaily: number;
  indexDailyBasic: number;
  weatherIndexDaily: number;
  swIndexDaily: number;
  oldestIndexWeightSnapshot: string;
  activeIndustries: number;
}

export async function validateIndexDate(
  tradeDate: string,
  maximumIndexWeightAgeDays = 190,
): Promise<IndexDateQuality> {
  const [indexCodes, indexBasicCodes, swIndexRows, activeIndustries, indexSnapshots] =
    await Promise.all([
      prisma.indexDaily.findMany({
        where: {
          tradeDate,
          tsCode: { in: DAILY_MAINTAINED_INDEX_CODES },
        },
        select: { tsCode: true },
      }),
      prisma.indexDailyBasic.findMany({
        where: { tradeDate, tsCode: { in: [...MAJOR_INDEX_DAILY_BASIC_CODES] } },
        select: { tsCode: true },
      }),
      prisma.swIndexDaily.findMany({
        where: { tradeDate },
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
        MARKET_WEATHER_INDICATOR_INDEX_CODES.map((indexCode) =>
          prisma.indexWeight.findFirst({
            where: { indexCode, tradeDate: { lte: tradeDate } },
            orderBy: { tradeDate: 'desc' },
            select: { tradeDate: true },
          }),
        ),
      ),
    ]);
  const actualIndexCodes = new Set(indexCodes.map((row) => row.tsCode));
  const missingIndexCodes = MAJOR_INDEX_DAILY_CODES.filter((code) => !actualIndexCodes.has(code));
  if (missingIndexCodes.length > 0) {
    throw new Error(`IndexDaily is missing ${missingIndexCodes.join(', ')} for ${tradeDate}`);
  }
  const missingWeatherCodes = MARKET_WEATHER_INDEX_CODES.filter(
    (code) => !actualIndexCodes.has(code),
  );
  if (missingWeatherCodes.length > 0) {
    throw new Error(
      `Market weather IndexDaily is missing ${missingWeatherCodes.join(', ')} for ${tradeDate}`,
    );
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
  const missingSnapshots = MARKET_WEATHER_INDICATOR_INDEX_CODES.filter(
    (_, index) => !indexSnapshots[index],
  );
  if (missingSnapshots.length > 0) {
    throw new Error(
      `IndexWeight has no point-in-time snapshot for ${missingSnapshots.join(', ')} by ${tradeDate}`,
    );
  }
  const oldestAllowedSnapshot = addCalendarDays(tradeDate, -maximumIndexWeightAgeDays);
  const staleSnapshots = MARKET_WEATHER_INDICATOR_INDEX_CODES.filter((_, index) => {
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
  if (swIndexRows.length !== 31) {
    throw new Error(
      `SwIndexDaily has ${swIndexRows.length}/31 level-1 industries for ${tradeDate}`,
    );
  }

  return {
    indexDaily: actualIndexCodes.size,
    indexDailyBasic: actualIndexBasicCodes.size,
    weatherIndexDaily: MARKET_WEATHER_INDEX_CODES.length,
    swIndexDaily: swIndexRows.length,
    oldestIndexWeightSnapshot: indexSnapshots.map((snapshot) => snapshot!.tradeDate).sort()[0],
    activeIndustries: activeIndustries.length,
  };
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
