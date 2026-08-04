import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { MARKET_WEATHER_INDEX_CODES } from '../src/store/index-presets.js';
import { syncIndexBenchmarks, syncIndexDaily, syncSwIndexDaily } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

function currentDate(): string {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

/** Sync the official index catalog, dashboard index closes, and SW2021 level-1 industry bars. */
async function main(): Promise<void> {
  const config = loadTushareConfig();
  const [start = '20150101', end = currentDate()] = process.argv.slice(2);
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }

  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });

  await syncIndexBenchmarks(client);
  for (const indexCode of MARKET_WEATHER_INDEX_CODES) {
    await syncIndexDaily(client, indexCode, start, end);
  }
  await syncSwIndexDaily(client, start, end);
}

main()
  .catch((error: unknown) => {
    console.error(
      'Market reference sync failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
