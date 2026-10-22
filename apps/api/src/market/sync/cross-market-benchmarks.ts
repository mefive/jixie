import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { addDays } from '#date';
import { CROSS_MARKET_BENCHMARKS } from '../registry/cross-market-benchmarks.js';
import { syncCrossMarketBenchmarks } from '../cross-market/benchmark-sync.js';
import { syncTradeCal } from '../calendar/sync.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const [startDate = '20050101', endDate = shanghaiToday()] = args;
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
  const summary = await syncCrossMarketBenchmarks(client, startDate, endDate);
  console.table(
    CROSS_MARKET_BENCHMARKS.map((benchmark) => ({
      benchmark: benchmark.id,
      providerCode: benchmark.providerCode,
      rows: summary.benchmarkRows[benchmark.id] ?? 0,
      tradableProxy: benchmark.tradableProxyTsCode,
    })),
  );
}

function shanghaiToday(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(stagingNow())
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}
