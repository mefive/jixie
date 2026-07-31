import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { syncMarketIndicators } from '../src/market/sync-market-indicators.js';
import { validateDerivedMarketRange, validateRawMarketDate } from '../src/maintenance/quality.js';
import { recentPublishedTradingDates, selfHealMarketDates } from '../src/maintenance/self-heal.js';
import { initializeDailyWatermark } from '../src/maintenance/state.js';
import { latestCompletedTradeDate } from '../src/signals/service.js';
import { TushareClient } from '../src/tushare/client.js';

async function main(): Promise<void> {
  const [argument] = process.argv.slice(2);
  if (argument && !/^\d{8}$/.test(argument)) {
    throw new Error('Usage: pnpm --filter api maintenance:init [YYYYMMDD]');
  }
  const latestCompleted = await latestCompletedTradeDate();
  if (!latestCompleted) {
    throw new Error('No completed SSE trading date is available');
  }
  if (argument && argument > latestCompleted) {
    throw new Error(`${argument} has not completed in Asia/Shanghai`);
  }
  const latest = await prisma.daily.findFirst({
    where: { tradeDate: { lte: latestCompleted } },
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  const tradeDate = argument ?? latest?.tradeDate;
  if (!tradeDate) {
    throw new Error('Daily is empty; complete the full import before initialization');
  }

  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const lookback = positiveInteger(process.env.MAINTENANCE_BASELINE_REPAIR_LOOKBACK_DAYS, 20);
  const dates = await recentPublishedTradingDates(tradeDate, lookback);
  const repair = await selfHealMarketDates(client, dates, { maxRepairDates: lookback });
  await validateRawMarketDate(tradeDate);
  const marketIndicator = await prisma.marketIndicator.findUnique({
    where: { tradeDate },
    select: { tradeDate: true },
  });
  if (repair.earliestDerivedChange || !marketIndicator) {
    await syncMarketIndicators(repair.earliestDerivedChange ?? tradeDate, tradeDate);
  }
  const validationStart = repair.earliestDerivedChange ?? tradeDate;
  await validateDerivedMarketRange(
    validationStart,
    tradeDate,
    validationStart === tradeDate ? [tradeDate] : dates.filter((date) => date >= validationStart),
  );
  await initializeDailyWatermark(tradeDate);
  console.log(
    `[maintenance:init] dailyPublishedThrough=${tradeDate}; repaired=${repair.repairedDates.length}; ensure the full audit passed before enabling timers`,
  );
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main()
  .catch((error: unknown) => {
    console.error(
      '[maintenance:init] failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
