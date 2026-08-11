import { syncCommodityContinuousReturns } from '../src/commodity/commodity-continuous-returns.js';
import { auditCommodityContinuousReturns } from '../src/commodity/commodity-continuous-return-quality.js';
import { loadTushareConfig } from '../src/config.js';
import { addDays } from '../src/lib/date.js';
import { prisma } from '../src/lib/prisma.js';
import { syncTradeCal } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

/**
 * Sync Tushare main mappings and rebuild the audited research-only commodity return ledger.
 * Usage: pnpm --filter api sync:commodity-continuous [start] [end]
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
  const contextStart = addDays(startDate, -21);
  await syncTradeCal(client, contextStart, addDays(endDate, 14));
  const summary = await syncCommodityContinuousReturns(client, startDate, endDate);
  const quality = await auditCommodityContinuousReturns({ startDate, endDate });
  console.log('Commodity continuous-return sync complete:', summary);
  console.log('Commodity continuous-return quality:', quality);
  if (quality.status === 'error') {
    throw new Error(quality.errors.join('; '));
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      'sync:commodity-continuous failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
