import { syncCommodityHoldingPositions } from '../src/commodity/commodity-holding-positions.js';
import { COMMODITY_HOLDING_SPECS } from '../src/commodity/commodity-futures.js';
import { loadTushareConfig } from '../src/config.js';
import { addDays } from '../src/lib/date.js';
import { prisma } from '../src/lib/prisma.js';
import { syncTradeCal } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

/**
 * Sync research-only ranked-member aggregates for representative AU/CU/M contracts.
 * Usage: pnpm --filter api sync:commodity-holdings [start] [end]
 */
async function main(): Promise<void> {
  const currentDate = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const [startDate = '20150105', endDate = currentDate] = process.argv.slice(2);
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  await syncTradeCal(client, startDate, addDays(endDate, 14));
  console.log(
    `Syncing research-only commodity holding rankings ${COMMODITY_HOLDING_SPECS.map((specification) => specification.productCode).join('/')} ${startDate} ~ ${endDate}`,
  );
  const summary = await syncCommodityHoldingPositions(client, startDate, endDate);
  console.log('Commodity holding position sync complete:', summary);
}

main()
  .catch((error: unknown) => {
    console.error(
      'sync:commodity-holdings failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
