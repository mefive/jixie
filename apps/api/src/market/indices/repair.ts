import { prisma } from '#infra/database/prisma.js';
import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../providers/tushare/client.js';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
  MAJOR_INDEX_DAILY_CODES,
  MARKET_WEATHER_INDEX_CODES,
} from '../registry/index-presets.js';
import { syncIndexDaily, syncIndexDailyBasic, syncSwIndexDaily } from './sync.js';

export interface IndexDateCounts {
  tradeDate: string;
  indexDailyCodes: string[];
  indexDailyBasicCodes: string[];
  swIndexDaily: number;
}

export function buildIndexDateRepairPlan(row: IndexDateCounts): {
  indices: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const dailyCodes = new Set(row.indexDailyCodes);
  const basicCodes = new Set(row.indexDailyBasicCodes);
  const missingDaily = MAJOR_INDEX_DAILY_CODES.filter((code) => !dailyCodes.has(code));
  const missingWeather = MARKET_WEATHER_INDEX_CODES.filter((code) => !dailyCodes.has(code));
  const missingBasic = MAJOR_INDEX_DAILY_BASIC_CODES.filter((code) => !basicCodes.has(code));
  const indices =
    missingDaily.length > 0 ||
    missingWeather.length > 0 ||
    missingBasic.length > 0 ||
    row.swIndexDaily < 31;
  if (missingDaily.length > 0) {
    reasons.push(`IndexDaily missing ${missingDaily.join(',')}`);
  }
  if (missingBasic.length > 0) {
    reasons.push(`IndexDailyBasic missing ${missingBasic.join(',')}`);
  }
  if (missingWeather.length > 0) {
    reasons.push(`Market weather IndexDaily missing ${missingWeather.join(',')}`);
  }
  if (row.swIndexDaily < 31) {
    reasons.push(`SwIndexDaily has ${row.swIndexDaily}/31 level-1 industries`);
  }

  return { indices, reasons };
}

export async function inspectIndexDates(tradeDates: string[]): Promise<IndexDateCounts[]> {
  const where = { tradeDate: { in: tradeDates } };
  const [daily, basic, industry] = await Promise.all([
    prisma.indexDaily.findMany({
      where: { ...where, tsCode: { in: DAILY_MAINTAINED_INDEX_CODES } },
      select: { tradeDate: true, tsCode: true },
    }),
    prisma.indexDailyBasic.findMany({
      where: { ...where, tsCode: { in: [...MAJOR_INDEX_DAILY_BASIC_CODES] } },
      select: { tradeDate: true, tsCode: true },
    }),
    prisma.swIndexDaily.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
  ]);
  const codesByDate = (rows: Array<{ tradeDate: string; tsCode: string }>) => {
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const codes = result.get(row.tradeDate) ?? [];
      codes.push(row.tsCode);
      result.set(row.tradeDate, codes);
    }
    return result;
  };
  const dailyByDate = codesByDate(daily);
  const basicByDate = codesByDate(basic);
  const industryByDate = new Map(industry.map((row) => [row.tradeDate, row._count._all]));
  return tradeDates.map((tradeDate) => ({
    tradeDate,
    indexDailyCodes: dailyByDate.get(tradeDate) ?? [],
    indexDailyBasicCodes: basicByDate.get(tradeDate) ?? [],
    swIndexDaily: industryByDate.get(tradeDate) ?? 0,
  }));
}

export async function repairIndexDate(client: TushareClient, tradeDate: TradeDate): Promise<void> {
  for (const indexCode of DAILY_MAINTAINED_INDEX_CODES) {
    await syncIndexDaily(client, indexCode, tradeDate, tradeDate);
  }
  await syncIndexDailyBasic(client, [...MAJOR_INDEX_DAILY_BASIC_CODES], tradeDate, tradeDate);
  await syncSwIndexDaily(client, tradeDate, tradeDate);
}
