import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { getDatabase } from '#infra/database/prisma.js';
import { syncMarketIndicators } from '../state/sync.js';

function currentDate(): string {
  return stagingNow().toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * 预计算全市场、时点指数证券池与申万一级行业状态。
 *
 * Precompute daily whole-market, point-in-time index, and Shenwan level-1 state.
 * Usage: pnpm --filter api sync market-state [start] [end]
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const [start = '20150101', end = currentDate()] = args;
  console.log(`Precomputing market state ${start} ~ ${end}\n`);

  await syncMarketIndicators(start, end);

  console.table({
    market_indicator: await getDatabase().marketIndicator.count(),
    index_indicator: await getDatabase().indexIndicator.count(),
    industry_indicator: await getDatabase().industryIndicator.count(),
  });
  console.log('Market-state precompute complete');
}
