import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncFinaIndicator, syncDividend } from '../src/store/sync.js';

/**
 * Sync per-stock financials (fina_indicator + dividend history) into the local store.
 * Usage: pnpm --filter api sync:fina [refresh]
 *   refresh — re-pull stocks synced before the 2026-07 fina_indicator column expansion
 *             (gross margin / net margin / debt ratio / YoY growth / ROA / cash-flow ratio;
 *             resumable, see syncFinaIndicator).
 *
 * Financial APIs are rate-limited (~80/min on lower tiers), so this uses a ≥800ms interval. All
 * syncs are resumable (skip stocks already present), so an interrupted run can simply be re-run.
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const refresh = process.argv[2] === 'refresh';
  const interval = Math.max(cfg.minIntervalMs, 800); // respect the financial 80/min limit
  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: interval,
  });

  console.log(
    `Syncing financials (fina_indicator + dividend, rate limit ${interval}ms/call${refresh ? ', column backfill' : ''})\n`,
  );
  await syncFinaIndicator(client, undefined, { refresh });
  await syncDividend(client);

  console.log('\nStored row counts:');
  console.table({
    fina_indicator: await prisma.finaIndicator.count(),
    dividend: await prisma.dividend.count(),
  });

  await prisma.$disconnect();
  console.log('✅ Financial sync complete');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:fina failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
