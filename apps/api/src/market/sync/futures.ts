import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { getDatabase } from '#infra/database/prisma.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import {
  syncFutureContracts,
  syncFutureDaily,
  syncFutureMappings,
  syncFutureSettlements,
} from '../futures/sync.js';
import { syncTradeCal } from '../calendar/sync.js';

/**
 * 同步中金所股指期货合约、日线、主力映射与结算参数。
 *
 * Sync CFFEX stock-index futures metadata, daily bars, main-contract mappings, and settlement params.
 * Usage: pnpm --filter api sync futures [start] [end]
 * Example: pnpm --filter api sync futures 20240101 20241231
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const config = loadTushareConfig();
  const currentDate = stagingNow().toISOString().slice(0, 10).replaceAll('-', '');
  const [start = `${stagingNow().getUTCFullYear()}0101`, end = currentDate] = args;
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });

  console.log(`Syncing CFFEX stock-index futures ${start} ~ ${end}\n`);
  await syncFutureContracts(client);
  await syncTradeCal(client, start, end, 'CFFEX');
  await syncFutureDaily(client, start, end);
  await syncFutureMappings(client, start, end);
  await syncFutureSettlements(client, start, end);

  console.log('\nStored row counts:');
  console.table({
    future_contract: await getDatabase().futureContract.count(),
    future_daily: await getDatabase().futureDaily.count(),
    future_mapping: await getDatabase().futureMapping.count(),
    future_settlement: await getDatabase().futureSettlement.count(),
  });
  console.log('✅ Stock-index futures sync complete');
}
