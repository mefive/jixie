import { loadTushareConfig } from '#market/providers/tushare/config.js';
import { TushareClient } from '#market/providers/tushare/client.js';
import { syncMarketIndicators } from '#market/state/sync.js';
import { latestCompletedTradeDate } from '#market/calendar/sse-close.js';
import { assertProductionLock } from './daily.js';
import { validateDerivedMarketRange } from './quality.js';
import {
  recentPublishedTradingDates,
  selfHealMarketDates,
  type SelfHealSummary,
} from './self-heal.js';

export async function repairBaseline(targetDate?: string): Promise<SelfHealSummary> {
  assertProductionLock();
  const latestCompleted = await latestCompletedTradeDate();
  if (!latestCompleted) {
    throw new Error('No completed SSE trading date is available');
  }
  const through = targetDate && targetDate < latestCompleted ? targetDate : latestCompleted;
  const lookback = positiveInteger(process.env.MAINTENANCE_BASELINE_REPAIR_LOOKBACK_DAYS, 20);
  const dates = await recentPublishedTradingDates(through, lookback);
  if (dates.length === 0) {
    throw new Error(`No open trading dates are available through ${through}`);
  }

  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const summary = await selfHealMarketDates(client, dates, {
    maxRepairDates: lookback,
  });
  if (summary.deferredDates.length > 0) {
    throw new Error(`Baseline self-heal deferred ${summary.deferredDates.length} dates`);
  }
  if (summary.earliestDerivedChange) {
    const affectedDates = dates.filter((date) => date >= summary.earliestDerivedChange!);
    await syncMarketIndicators(summary.earliestDerivedChange, dates.at(-1)!);
    await validateDerivedMarketRange(summary.earliestDerivedChange, dates.at(-1)!, affectedDates);
  }
  return summary;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
