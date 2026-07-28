import dayjs from 'dayjs';
import type { TradeDate } from '@jixie/shared';
import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { seedStockCodeChanges, syncStockBasic, syncStockNameHistory } from '../src/store/sync.js';

/**
 * Refresh the complete stock master and point-in-time historical names.
 * Usage: pnpm --filter api sync:stock-history [announcementStart] [announcementEnd]
 */
async function main(): Promise<void> {
  const config = loadTushareConfig();
  const [start = '19900101', end = dayjs().format('YYYYMMDD')] = process.argv.slice(2) as [
    TradeDate?,
    TradeDate?,
  ];
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });

  console.log(`Syncing complete stock reference data and name history ${start} ~ ${end}`);
  const codeChanges = await seedStockCodeChanges();
  const stockBasic = await syncStockBasic(client);
  const stockNameHistory = await syncStockNameHistory(client, start, end);

  console.table({ stockBasic, stockNameHistory, codeChanges });
  await prisma.$disconnect();
  console.log('Stock-history sync complete');
}

main().catch(async (error: unknown) => {
  console.error('sync:stock-history failed:', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
