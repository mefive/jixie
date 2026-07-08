import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncSwIndustry } from '../src/store/sync.js';

/**
 * Sync Shenwan (SW2021) level-1 industry membership into the local store — the point-in-time
 * (stock → industry) map behind factor industry-neutralization (3.4).
 * Usage: pnpm --filter api sync:sw-industry
 *
 * Full overwrite each run (small volume). Two calls per industry (current + historical members),
 * 31 industries, so a ~300ms interval keeps it well under Tushare rate limits.
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: Math.max(cfg.minIntervalMs, 300),
  });

  console.log('Syncing Shenwan (SW2021) level-1 industry membership\n');
  const count = await syncSwIndustry(client);

  console.log('\nStored row counts:');
  console.table({ sw_industry_member: count });

  await prisma.$disconnect();
  console.log('✅ SW industry sync complete');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:sw-industry failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
