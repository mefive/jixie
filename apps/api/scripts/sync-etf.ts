import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { MAJOR_ETF_CODES } from '../src/store/etf-presets.js';
import { syncEtfBasic, syncEtfDaily, syncTradeCal } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

function parseCodes(selector: string): string[] {
  if (selector === 'major') {
    return [...MAJOR_ETF_CODES];
  }
  return selector
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Sync ETF metadata plus selected daily bars/adjustment factors.
 * Usage: pnpm --filter api sync:etf [start] [end] [major|CODE,CODE] [refresh]
 */
async function main(): Promise<void> {
  const config = loadTushareConfig();
  const currentDate = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const [start = '20150101', end = currentDate, selector = 'major', refreshArg] =
    process.argv.slice(2);
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
  const codes = parseCodes(selector);
  if (codes.length === 0) {
    throw new Error('No ETF codes selected');
  }

  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  console.log(`Syncing ETF metadata + ${codes.length} instruments ${start} ~ ${end}\n`);
  await syncTradeCal(client, start, end);
  await syncEtfBasic(client);
  await syncEtfDaily(client, codes, start, end, { refresh: refreshArg === 'refresh' });

  console.log('\nStored row counts:');
  console.table({
    etf_basic: await prisma.etfBasic.count(),
    etf_daily: await prisma.etfDaily.count(),
    etf_adj_factor: await prisma.etfAdjFactor.count(),
  });
  await prisma.$disconnect();
  console.log('✅ ETF sync complete');
}

main().catch(async (error: unknown) => {
  console.error('\n❌ sync:etf failed: ', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
