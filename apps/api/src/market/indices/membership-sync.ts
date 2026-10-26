import { getDatabase } from '#infra/database/prisma.js';
import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../providers/tushare/tushare-client.js';
import { INDEX_MEMBERSHIP_CODES } from '../registry/index-presets.js';
import { syncIndexWeight, syncSwIndustry } from './sync.js';

/**
 * 回填历史指数成分权重，供时点证券池查询。
 *
 * Synchronize historical index membership for point-in-time universe reads.
 */
export async function syncIndexMembershipHistory(
  client: TushareClient,
  startDate: string,
  endDate: string,
): Promise<string | null> {
  const indexBefore = await getDatabase().indexWeight.findMany({
    where: {
      indexCode: { in: INDEX_MEMBERSHIP_CODES },
      tradeDate: { gte: startDate, lte: endDate },
    },
    orderBy: [{ indexCode: 'asc' }, { tradeDate: 'asc' }, { conCode: 'asc' }],
  });
  for (const indexCode of INDEX_MEMBERSHIP_CODES) {
    await syncIndexWeight(client, indexCode, startDate as TradeDate, endDate as TradeDate);
  }
  const indexAfter = await getDatabase().indexWeight.findMany({
    where: {
      indexCode: { in: INDEX_MEMBERSHIP_CODES },
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

/**
 * 同步行业成员历史并检测修订范围。
 *
 * Synchronize industry membership history and detect revisions.
 */
export async function syncIndustryMembershipHistory(client: TushareClient): Promise<string | null> {
  const industryBefore = await getDatabase().swIndustryMember.findMany({
    orderBy: [{ tsCode: 'asc' }, { l1Code: 'asc' }, { inDate: 'asc' }],
  });
  await syncSwIndustry(client);
  const industryAfter = await getDatabase().swIndustryMember.findMany({
    orderBy: [{ tsCode: 'asc' }, { l1Code: 'asc' }, { inDate: 'asc' }],
  });
  return earliestChangedDate(
    industryBefore,
    industryAfter,
    (row) => `${row.tsCode}|${row.l1Code}|${row.inDate}`,
    (row) => row.inDate,
  );
}

/**
 * 比较新旧成员记录，定位最早受影响日期。
 *
 * Find the earliest changed membership date across snapshots.
 */
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
