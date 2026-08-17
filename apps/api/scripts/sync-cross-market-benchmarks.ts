import { loadTushareConfig } from '../src/config.js';
import { addDays } from '../src/lib/date.js';
import { prisma } from '../src/lib/prisma.js';
import {
  CROSS_MARKET_BENCHMARKS,
  syncCrossMarketBenchmarks,
} from '../src/market/cross-market-benchmarks.js';
import { syncTradeCal } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

async function main(): Promise<void> {
  const [startDate = '20050101', endDate = shanghaiToday()] = process.argv.slice(2);
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
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}

main()
  .catch((error: unknown) => {
    console.error(
      'Cross-market benchmark sync failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
