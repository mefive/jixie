import { prisma } from '#infra/database/prisma.js';
import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../providers/tushare/client.js';
import { MARKET_WEATHER_INDICATOR_INDEX_CODES } from '../registry/index-presets.js';
import { syncIndexWeight, syncSwIndustry } from './sync.js';

export async function syncIndexMembershipHistory(
  client: TushareClient,
  startDate: string,
  endDate: string,
): Promise<string | null> {
  const indexBefore = await prisma.indexWeight.findMany({
    where: {
      indexCode: { in: MARKET_WEATHER_INDICATOR_INDEX_CODES },
      tradeDate: { gte: startDate, lte: endDate },
    },
    orderBy: [{ indexCode: 'asc' }, { tradeDate: 'asc' }, { conCode: 'asc' }],
  });
  for (const indexCode of MARKET_WEATHER_INDICATOR_INDEX_CODES) {
    await syncIndexWeight(client, indexCode, startDate as TradeDate, endDate as TradeDate);
  }
  const indexAfter = await prisma.indexWeight.findMany({
    where: {
      indexCode: { in: MARKET_WEATHER_INDICATOR_INDEX_CODES },
      tradeDate: { gte: startDate, lte: endDate },
    },
    orderBy: [{ indexCode: 'asc' }, { tradeDate: 'asc' }, { conCode: 'asc' }],
  });
  return earliestChangedDate(
    indexBefore,
    indexAfter,
    (row) => `${row.indexCode}|${row.conCode}|${row.tradeDate}`,
    (row) => row.tradeDate,
  );
}

export async function syncIndustryMembershipHistory(client: TushareClient): Promise<string | null> {
  const industryBefore = await prisma.swIndustryMember.findMany({
    orderBy: [{ tsCode: 'asc' }, { l1Code: 'asc' }, { inDate: 'asc' }],
  });
  await syncSwIndustry(client);
  const industryAfter = await prisma.swIndustryMember.findMany({
    orderBy: [{ tsCode: 'asc' }, { l1Code: 'asc' }, { inDate: 'asc' }],
  });
  return earliestChangedDate(
    industryBefore,
    industryAfter,
    (row) => `${row.tsCode}|${row.l1Code}|${row.inDate}`,
    (row) => row.inDate,
  );
}

function earliestChangedDate<Row>(
  before: Row[],
  after: Row[],
  keyOf: (row: Row) => string,
  dateOf: (row: Row) => string,
): string | null {
  const beforeByKey = new Map(before.map((row) => [keyOf(row), JSON.stringify(row)]));
  const afterByKey = new Map(after.map((row) => [keyOf(row), JSON.stringify(row)]));
  const rowByKey = new Map([...before, ...after].map((row) => [keyOf(row), row]));
  const changedDates: string[] = [];
  for (const [key, row] of rowByKey) {
    if (beforeByKey.get(key) !== afterByKey.get(key)) {
      changedDates.push(dateOf(row));
    }
  }
  return changedDates.sort()[0] ?? null;
}
