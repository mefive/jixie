import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { TushareClient } from '../src/tushare/client.js';
import {
  syncFutureContracts,
  syncFutureDaily,
  syncFutureMappings,
  syncFutureSettlements,
  syncTradeCal,
} from '../src/store/sync.js';

/**
 * Sync CFFEX stock-index futures metadata, daily bars, main-contract mappings, and settlement params.
 * Usage: pnpm --filter api sync:futures [start] [end]
 * Example: pnpm --filter api sync:futures 20240101 20241231
 */
async function main(): Promise<void> {
  const config = loadTushareConfig();
  const currentDate = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const [start = `${new Date().getUTCFullYear()}0101`, end = currentDate] = process.argv.slice(2);
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
    future_contract: await prisma.futureContract.count(),
    future_daily: await prisma.futureDaily.count(),
    future_mapping: await prisma.futureMapping.count(),
    future_settlement: await prisma.futureSettlement.count(),
  });
  await prisma.$disconnect();
  console.log('✅ Stock-index futures sync complete');
}

main().catch(async (error: unknown) => {
  console.error('\n❌ sync:futures failed: ', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
