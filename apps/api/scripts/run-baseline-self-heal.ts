import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { syncMarketIndicators } from '../src/market/sync-market-indicators.js';
import { validateDerivedMarketRange } from '../src/maintenance/quality.js';
import { recentPublishedTradingDates, selfHealMarketDates } from '../src/maintenance/self-heal.js';
import { latestCompletedTradeDate } from '../src/signals/service.js';
import { TushareClient } from '../src/tushare/client.js';

async function main(): Promise<void> {
  const [argument] = process.argv.slice(2);
  if (argument && !/^\d{8}$/.test(argument)) {
    throw new Error('Usage: pnpm --filter api maintenance:heal-baseline [YYYYMMDD]');
  }
  const latestCompleted = await latestCompletedTradeDate();
  if (!latestCompleted) {
    throw new Error('No completed SSE trading date is available');
  }
  const through = argument && argument < latestCompleted ? argument : latestCompleted;
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
  console.log('[maintenance:heal-baseline] complete', summary);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main()
  .catch((error: unknown) => {
    console.error(
      '[maintenance:heal-baseline] failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
