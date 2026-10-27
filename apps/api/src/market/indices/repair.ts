import { getDatabase } from '#infra/database/prisma.js';
import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../providers/tushare/tushare-client.js';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
  MAJOR_INDEX_DAILY_CODES,
} from '../registry/index-presets.js';
import { syncIndexDaily, syncIndexDailyBasic } from './sync.js';

/**
 * 记录指数逐日数量，供修复计划比较。
 *
 * Supply index date counts for repair planning.
 */
export interface IndexDateCounts {
  tradeDate: string;
  indexDailyCodes: string[];
  indexDailyBasicCodes: string[];
}

/**
 * 比较目标日期记录量与所需覆盖，生成指数补齐计划。
 *
 * Build an index repair plan from observed and required date coverage.
 */
export function buildIndexDateRepairPlan(row: IndexDateCounts): {
  indices: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const dailyCodes = new Set(row.indexDailyCodes);
  const basicCodes = new Set(row.indexDailyBasicCodes);
  const missingDaily = MAJOR_INDEX_DAILY_CODES.filter((code) => !dailyCodes.has(code));
  const missingBasic = MAJOR_INDEX_DAILY_BASIC_CODES.filter((code) => !basicCodes.has(code));
  const indices = missingDaily.length > 0 || missingBasic.length > 0;
  if (missingDaily.length > 0) {
    reasons.push(`IndexDaily missing ${missingDaily.join(',')}`);
  }
  if (missingBasic.length > 0) {
    reasons.push(`IndexDailyBasic missing ${missingBasic.join(',')}`);
  }

  return { indices, reasons };
}

/**
 * 读取指定日期的指数数据覆盖，供修复规划。
 *
 * Inspect index coverage on requested dates for repair planning.
 */
export async function inspectIndexDates(tradeDates: string[]): Promise<IndexDateCounts[]> {
  const where = { tradeDate: { in: tradeDates } };
  const [daily, basic] = await Promise.all([
    getDatabase().indexDaily.findMany({
      where: { ...where, tsCode: { in: DAILY_MAINTAINED_INDEX_CODES } },
      select: { tradeDate: true, tsCode: true },
    }),
    getDatabase().indexDailyBasic.findMany({
      where: { ...where, tsCode: { in: [...MAJOR_INDEX_DAILY_BASIC_CODES] } },
      select: { tradeDate: true, tsCode: true },
    }),
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
  return tradeDates.map((tradeDate) => ({
    tradeDate,
    indexDailyCodes: dailyByDate.get(tradeDate) ?? [],
    indexDailyBasicCodes: basicByDate.get(tradeDate) ?? [],
  }));
}

/**
 * 按缺口补齐指数行情与估值，返回单日修复结果。
 *
 * Repair missing index prices and valuations for a date.
 */
export async function repairIndexDate(client: TushareClient, tradeDate: TradeDate): Promise<void> {
  for (const indexCode of DAILY_MAINTAINED_INDEX_CODES) {
    await syncIndexDaily(client, indexCode, tradeDate, tradeDate);
  }
  await syncIndexDailyBasic(client, [...MAJOR_INDEX_DAILY_BASIC_CODES], tradeDate, tradeDate);
}
