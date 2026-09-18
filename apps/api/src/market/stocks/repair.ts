import { prisma } from '#infra/database/prisma.js';
import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../providers/tushare/client.js';
import { syncDailyCoreDate } from './daily-sync.js';
import { syncMoneyflow, syncTopList } from './flows-sync.js';

export interface StockDateCounts {
  tradeDate: string;
  daily: number;
  adjustment: number;
  basic: number;
  limits: number;
  moneyflow: number;
}

export interface StockDateRepair {
  tradeDate: string;
  core: boolean;
  moneyflow: boolean;
  reasons: string[];
}

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
    const moneyflowCoverage = coverage(row.moneyflow, row.daily);
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

    // A core refresh can change the denominator and stock universe, so refresh the flow slice too.
    const moneyflow = core || moneyflowCoverage < 0.7;
    if (!core && moneyflowCoverage < 0.7) {
      reasons.push(`Moneyflow coverage ${percent(moneyflowCoverage)}`);
    }

    return { tradeDate: row.tradeDate, core, moneyflow, reasons };
  });
}

export async function inspectStockDates(tradeDates: string[]): Promise<StockDateCounts[]> {
  const where = { tradeDate: { in: tradeDates } };
  const rows = await Promise.all([
    prisma.daily.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
    prisma.adjFactor.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
    prisma.dailyBasic.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
    prisma.stkLimit.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
    prisma.moneyflow.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
  ]);
  const [daily, adjustment, basic, limits, moneyflow] = rows.map(
    (dataset) => new Map(dataset.map((row) => [row.tradeDate, row._count._all])),
  );
  return tradeDates.map((tradeDate) => ({
    tradeDate,
    daily: daily.get(tradeDate) ?? 0,
    adjustment: adjustment.get(tradeDate) ?? 0,
    basic: basic.get(tradeDate) ?? 0,
    limits: limits.get(tradeDate) ?? 0,
    moneyflow: moneyflow.get(tradeDate) ?? 0,
  }));
}

export async function repairStockDate(
  client: TushareClient,
  repair: StockDateRepair,
): Promise<void> {
  const tradeDate = repair.tradeDate as TradeDate;
  if (repair.core) {
    await syncDailyCoreDate(client, tradeDate);
  }
  if (repair.moneyflow) {
    await syncMoneyflow(client, tradeDate, tradeDate, { refresh: true });
  }
  if (repair.core || repair.moneyflow) {
    await syncTopList(client, tradeDate, tradeDate, { refresh: true });
  }
}

function coverage(rows: number, daily: number): number {
  return daily > 0 ? rows / daily : 0;
}

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
