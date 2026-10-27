import { getDatabase } from '#infra/database/prisma.js';
import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../providers/tushare/tushare-client.js';
import { syncStockDailyData } from './daily-sync.js';

/**
 * 记录股票各数据集单日数量，供修复比较。
 *
 * Supply stock dataset counts for dated repair checks.
 */
export interface StockDateCounts {
  tradeDate: string;
  daily: number;
  adjustment: number;
  basic: number;
  limits: number;
}

/**
 * 描述单日需补齐数据种类，供定向修复。
 *
 * Identify missing dated stock datasets for targeted repair.
 */
export interface StockDateRepair {
  tradeDate: string;
  core: boolean;
  reasons: string[];
}

/**
 * 比较股票日期覆盖与预期数据集，生成最小补齐计划。
 *
 * Build a stock-date repair plan from required datasets and observed coverage.
 */
export function buildStockDateRepairPlan(counts: StockDateCounts[]): StockDateRepair[] {
  const populatedDailyCounts = counts
    .map((row) => row.daily)
    .filter((count) => count > 0)
    .sort((left, right) => left - right);
  const medianDaily = median(populatedDailyCounts);

  return counts.map((row) => {
    const reasons: string[] = [];
    const dailyCliff =
      row.daily === 0 || (medianDaily != null && row.daily < Math.floor(medianDaily * 0.7));
    const adjustmentCoverage = coverage(row.adjustment, row.daily);
    const basicCoverage = coverage(row.basic, row.daily);
    const limitCoverage = coverage(row.limits, row.daily);
    const core =
      dailyCliff || adjustmentCoverage < 0.98 || basicCoverage < 0.85 || limitCoverage < 0.85;

    if (row.daily === 0) {
      reasons.push('Daily empty');
    } else if (dailyCliff) {
      reasons.push(`Daily row cliff ${row.daily}/${medianDaily}`);
    }
    if (adjustmentCoverage < 0.98) {
      reasons.push(`AdjFactor coverage ${percent(adjustmentCoverage)}`);
    }
    if (basicCoverage < 0.85) {
      reasons.push(`DailyBasic coverage ${percent(basicCoverage)}`);
    }
    if (limitCoverage < 0.85) {
      reasons.push(`StkLimit coverage ${percent(limitCoverage)}`);
    }

    return { tradeDate: row.tradeDate, core, reasons };
  });
}

export async function inspectStockDates(tradeDates: string[]): Promise<StockDateCounts[]> {
  const where = { tradeDate: { in: tradeDates } };
  const rows = await Promise.all([
    getDatabase().daily.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
    getDatabase().adjFactor.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
    getDatabase().dailyBasic.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
    getDatabase().stkLimit.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
  ]);
  const [daily, adjustment, basic, limits] = rows.map(
    (dataset) => new Map(dataset.map((row) => [row.tradeDate, row._count._all])),
  );
  return tradeDates.map((tradeDate) => ({
    tradeDate,
    daily: daily.get(tradeDate) ?? 0,
    adjustment: adjustment.get(tradeDate) ?? 0,
    basic: basic.get(tradeDate) ?? 0,
    limits: limits.get(tradeDate) ?? 0,
  }));
}

/**
 * 按缺口计划修复单日股票数据并返回校验结果。
 *
 * Repair one stock market date according to its gap plan and validate the outcome.
 */
export async function repairStockDate(
  client: TushareClient,
  repair: StockDateRepair,
): Promise<void> {
  const tradeDate = repair.tradeDate as TradeDate;
  if (repair.core) {
    await syncStockDailyData(client, tradeDate);
  }
}

function coverage(rows: number, daily: number): number {
  return daily > 0 ? rows / daily : 0;
}

/**
 * 从计数样本计算中位数，供修复覆盖阈值。
 *
 * Compute a count median for repair coverage thresholds.
 */
function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
