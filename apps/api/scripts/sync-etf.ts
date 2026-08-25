import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { syncEtfShareSizeRange } from '../src/store/etf-market-sync.js';
import { MAJOR_ETF_CODES } from '../src/store/etf-presets.js';
import { ETF_RESEARCH_CODES } from '../src/store/etf-research-registry.js';
import { syncEtfBasic, syncEtfDaily, syncTradeCal } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

function parseCodes(selector: string): string[] {
  if (selector === 'registry') {
    return [...ETF_RESEARCH_CODES];
  }
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
 * Usage: pnpm --filter api sync:etf [start] [end] [registry|major|CODE,CODE] [refresh]
 */
async function main(): Promise<void> {
  const config = loadTushareConfig();
  const currentDate = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const [start = '20150101', end = currentDate, selector = 'registry', refreshArg] =
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
  await syncTradeCal(client, start, addCalendarDays(end, 14));
  await syncEtfBasic(client);
  await syncEtfDaily(client, codes, start, end, { refresh: refreshArg === 'refresh' });
  await syncEtfShareSizeRange(client, start, end, codes, {
    refresh: refreshArg === 'refresh',
  });

  console.log('\nStored row counts:');
  console.table({
    etf_basic: await prisma.etfBasic.count(),
    etf_daily: await prisma.etfDaily.count(),
    etf_adj_factor: await prisma.etfAdjFactor.count(),
    etf_share_size: await prisma.etfShareSize.count(),
  });
  await prisma.$disconnect();
  console.log('✅ ETF sync complete');
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)) + days,
    ),
  );
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

main().catch(async (error: unknown) => {
  console.error('\n❌ sync:etf failed: ', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
