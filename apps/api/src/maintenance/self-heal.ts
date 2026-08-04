import type { TradeDate } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import {
  MAJOR_INDEX_DAILY_BASIC_CODES,
  MAJOR_INDEX_DAILY_CODES,
  DAILY_MAINTAINED_INDEX_CODES,
  MARKET_WEATHER_INDEX_CODES,
} from '../store/index-presets.js';
import {
  syncDailyCoreDate,
  syncIndexDaily,
  syncIndexDailyBasic,
  syncMoneyflow,
  syncSwIndexDaily,
  syncTopList,
} from '../store/sync.js';
import type { TushareClient } from '../tushare/client.js';
import { validateRawMarketDate } from './quality.js';

export interface MarketDateCounts {
  tradeDate: string;
  daily: number;
  adjustment: number;
  basic: number;
  limits: number;
  moneyflow: number;
  indexDailyCodes: string[];
  indexDailyBasicCodes: string[];
  swIndexDaily: number;
}

export interface MarketDateRepair {
  tradeDate: string;
  core: boolean;
  moneyflow: boolean;
  indices: boolean;
  reasons: string[];
}

export interface SelfHealSummary {
  inspectedDates: number;
  plannedDates: number;
  repairedDates: string[];
  coreDates: string[];
  moneyflowDates: string[];
  indexDates: string[];
  deferredDates: string[];
  earliestDerivedChange: string | null;
}

export interface SelfHealOptions {
  maxRepairDates?: number;
  onLog?: (line: string) => void;
}

/**
 * Find deterministic, allowlisted defects in dense daily slices. Reference-data defects and code
 * identity conflicts deliberately remain hard failures because guessing a repair would change PIT
 * semantics.
 */
export function buildMarketDateRepairPlan(counts: MarketDateCounts[]): MarketDateRepair[] {
  const populatedDailyCounts = counts
    .map((row) => row.daily)
    .filter((count) => count > 0)
    .sort((left, right) => left - right);
  const medianDaily = median(populatedDailyCounts);

  return counts.flatMap((row) => {
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

    return core || moneyflow || indices
      ? [{ tradeDate: row.tradeDate, core, moneyflow, indices, reasons }]
      : [];
  });
}

export async function recentPublishedTradingDates(
  through: string,
  lookbackTradingDays: number,
): Promise<string[]> {
  const rows = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lte: through } },
    orderBy: { calDate: 'desc' },
    take: lookbackTradingDays,
    select: { calDate: true },
  });
  return rows.map((row) => row.calDate).reverse();
}

export async function selfHealMarketDates(
  client: TushareClient,
  tradeDates: string[],
  options: SelfHealOptions = {},
): Promise<SelfHealSummary> {
  const dates = [...new Set(tradeDates)].sort();
  if (dates.length === 0) {
    return emptySummary();
  }
  const onLog = options.onLog ?? ((line: string) => console.log(`[maintenance:self-heal] ${line}`));
  const counts = await inspectMarketDates(dates);
  const fullPlan = buildMarketDateRepairPlan(counts);
  const maximum = options.maxRepairDates ?? fullPlan.length;
  const plan = fullPlan.slice(0, maximum);
  const deferredDates = fullPlan.slice(maximum).map((repair) => repair.tradeDate);
  const summary: SelfHealSummary = {
    inspectedDates: dates.length,
    plannedDates: fullPlan.length,
    repairedDates: [],
    coreDates: [],
    moneyflowDates: [],
    indexDates: [],
    deferredDates,
    earliestDerivedChange: null,
  };

  if (fullPlan.length === 0) {
    onLog(`Validated ${dates.length} published dates; no allowlisted gaps found`);
    return summary;
  }
  onLog(
    `Found ${fullPlan.length} repairable dates; repairing ${plan.length}` +
      (deferredDates.length > 0 ? ` and deferring ${deferredDates.length}` : ''),
  );

  for (const repair of plan) {
    const tradeDate = repair.tradeDate as TradeDate;
    onLog(`${tradeDate}: ${repair.reasons.join('; ')}`);
    if (repair.core) {
      await syncDailyCoreDate(client, tradeDate);
      summary.coreDates.push(tradeDate);
    }
    if (repair.moneyflow) {
      await syncMoneyflow(client, tradeDate, tradeDate, { refresh: true });
      summary.moneyflowDates.push(tradeDate);
    }
    if (repair.core || repair.moneyflow) {
      await syncTopList(client, tradeDate, tradeDate, { refresh: true });
    }
    if (repair.indices) {
      for (const indexCode of DAILY_MAINTAINED_INDEX_CODES) {
        await syncIndexDaily(client, indexCode, tradeDate, tradeDate);
      }
      await syncIndexDailyBasic(client, [...MAJOR_INDEX_DAILY_BASIC_CODES], tradeDate, tradeDate);
      await syncSwIndexDaily(client, tradeDate, tradeDate);
      summary.indexDates.push(tradeDate);
    }
    await validateRawMarketDate(tradeDate);
    summary.repairedDates.push(tradeDate);
  }

  summary.earliestDerivedChange = [...summary.coreDates, ...summary.indexDates].sort()[0] ?? null;
  return summary;
}

async function inspectMarketDates(tradeDates: string[]): Promise<MarketDateCounts[]> {
  const where = { tradeDate: { in: tradeDates } };
  const [daily, adjustment, basic, limits, moneyflow, indexDaily, indexDailyBasic, swIndexDaily] =
    await Promise.all([
      prisma.daily.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
      prisma.adjFactor.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
      prisma.dailyBasic.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
      prisma.stkLimit.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
      prisma.moneyflow.groupBy({ by: ['tradeDate'], where, _count: { _all: true } }),
      prisma.indexDaily.findMany({
        where: {
          ...where,
          tsCode: { in: DAILY_MAINTAINED_INDEX_CODES },
        },
        select: { tradeDate: true, tsCode: true },
      }),
      prisma.indexDailyBasic.findMany({
        where: { ...where, tsCode: { in: [...MAJOR_INDEX_DAILY_BASIC_CODES] } },
        select: { tradeDate: true, tsCode: true },
      }),
      prisma.swIndexDaily.groupBy({
        by: ['tradeDate'],
        where,
        _count: { _all: true },
      }),
    ]);

  const countMap = (rows: Array<{ tradeDate: string; _count: { _all: number } }>) =>
    new Map(rows.map((row) => [row.tradeDate, row._count._all]));
  const codesByDate = (rows: Array<{ tradeDate: string; tsCode: string }>) => {
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const codes = result.get(row.tradeDate) ?? [];
      codes.push(row.tsCode);
      result.set(row.tradeDate, codes);
    }
    return result;
  };
  const dailyByDate = countMap(daily);
  const adjustmentByDate = countMap(adjustment);
  const basicByDate = countMap(basic);
  const limitsByDate = countMap(limits);
  const moneyflowByDate = countMap(moneyflow);
  const indexDailyByDate = codesByDate(indexDaily);
  const indexDailyBasicByDate = codesByDate(indexDailyBasic);
  const swIndexDailyByDate = countMap(swIndexDaily);

  return tradeDates.map((tradeDate) => ({
    tradeDate,
    daily: dailyByDate.get(tradeDate) ?? 0,
    adjustment: adjustmentByDate.get(tradeDate) ?? 0,
    basic: basicByDate.get(tradeDate) ?? 0,
    limits: limitsByDate.get(tradeDate) ?? 0,
    moneyflow: moneyflowByDate.get(tradeDate) ?? 0,
    indexDailyCodes: indexDailyByDate.get(tradeDate) ?? [],
    indexDailyBasicCodes: indexDailyBasicByDate.get(tradeDate) ?? [],
    swIndexDaily: swIndexDailyByDate.get(tradeDate) ?? 0,
  }));
}

function emptySummary(): SelfHealSummary {
  return {
    inspectedDates: 0,
    plannedDates: 0,
    repairedDates: [],
    coreDates: [],
    moneyflowDates: [],
    indexDates: [],
    deferredDates: [],
    earliestDerivedChange: null,
  };
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
