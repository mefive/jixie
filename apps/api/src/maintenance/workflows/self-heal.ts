import {
  buildIndexDateRepairPlan,
  inspectIndexDates,
  repairIndexDate,
  type IndexDateCounts,
} from '#market/indices/repair.js';
import type { TushareClient } from '#market/providers/tushare/tushare-client.js';
import {
  buildStockDateRepairPlan,
  inspectStockDates,
  repairStockDate,
  type StockDateCounts,
} from '#market/stocks/repair.js';
import type { TradeDate } from '@jixie/shared';
import { validateRawMarketDate } from '../publication/gate.js';

/**
 * 汇总单日市场数据数量，供完整性比较和修复判定。
 *
 * Collect market-date row counts for completeness checks and repair decisions.
 */
export interface MarketDateCounts extends StockDateCounts, IndexDateCounts {}

/**
 * 记录单个日期需要执行的修复，供自愈流程排队处理。
 *
 * Describe the repair required for one market date in self-healing maintenance.
 */
export interface MarketDateRepair {
  tradeDate: string;
  core: boolean;
  moneyflow: boolean;
  indices: boolean;
  reasons: string[];
}

/**
 * 汇总自愈检查和修复结果，供维护审计与输出。
 *
 * Summarize self-healing checks and repairs for maintenance auditing.
 */
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

/**
 * 配置自愈日期范围与执行回调，供维护工作流复用。
 *
 * Configure date bounds and execution callbacks for market self-healing.
 */
export interface SelfHealOptions {
  maxRepairDates?: number;
  onLog?: (line: string) => void;
  drain?: boolean;
  beforeRepair?: (repair: MarketDateRepair) => Promise<void>;
  onProgress?: (summary: SelfHealSummary) => Promise<void>;
}

export function buildMarketDateRepairPlan(counts: MarketDateCounts[]): MarketDateRepair[] {
  const stockPlan = buildStockDateRepairPlan(counts);
  return counts.flatMap((row, index) => {
    const stock = stockPlan[index];
    const indices = buildIndexDateRepairPlan(row);
    return stock.core || stock.moneyflow || indices.indices
      ? [{ ...stock, indices: indices.indices, reasons: [...stock.reasons, ...indices.reasons] }]
      : [];
  });
}

/**
 * 逐日检查市场覆盖并修复可恢复缺口，汇总无法修复的异常。
 *
 * Check daily market coverage, repair recoverable gaps and summarize unresolved issues.
 */
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
  if (fullPlan.length > 0 && (!Number.isInteger(maximum) || maximum <= 0)) {
    throw new Error('Self-heal batch size must be a positive integer');
  }
  const plan = options.drain ? fullPlan : fullPlan.slice(0, maximum);
  const deferredDates = fullPlan.slice(plan.length).map((repair) => repair.tradeDate);
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
    await options.beforeRepair?.(repair);
    onLog(`${tradeDate}: ${repair.reasons.join('; ')}`);
    await repairStockDate(client, repair);
    if (repair.core) {
      summary.coreDates.push(tradeDate);
    }
    if (repair.moneyflow) {
      summary.moneyflowDates.push(tradeDate);
    }
    if (repair.indices) {
      await repairIndexDate(client, tradeDate);
      summary.indexDates.push(tradeDate);
    }
    await validateRawMarketDate(tradeDate);
    const remaining = buildMarketDateRepairPlan(await inspectMarketDates([tradeDate]));
    if (remaining.length > 0) {
      throw new Error(
        `Self-heal made insufficient progress on ${tradeDate}: ${remaining[0].reasons.join('; ')}`,
      );
    }
    summary.repairedDates.push(tradeDate);
    summary.earliestDerivedChange = [...summary.coreDates, ...summary.indexDates].sort()[0] ?? null;
    if (
      summary.repairedDates.length % maximum === 0 ||
      summary.repairedDates.length === plan.length
    ) {
      await options.onProgress?.(summary);
    }
  }

  summary.earliestDerivedChange = [...summary.coreDates, ...summary.indexDates].sort()[0] ?? null;
  return summary;
}

async function inspectMarketDates(tradeDates: string[]): Promise<MarketDateCounts[]> {
  const [stocks, indices] = await Promise.all([
    inspectStockDates(tradeDates),
    inspectIndexDates(tradeDates),
  ]);
  return stocks.map((stock, index) => ({ ...stock, ...indices[index] }));
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
