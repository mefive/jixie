import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { MARKET_WEATHER_INDICATOR_INDEX_CODES } from '../src/store/index-presets.js';
import { syncIndexWeight, syncIndexDaily } from '../src/store/sync.js';

function parseCodes(value: string): string[] {
  if (value === 'market-state') {
    return [...MARKET_WEATHER_INDICATOR_INDEX_CODES];
  }

  return value
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Sync index constituents (index_weight) + daily close (index_daily) into the local store.
 * Usage: pnpm --filter api sync:index [market-state|CODE,CODE] [start] [end]
 *   default: 000852.SH (CSI 1000) 2015-2024
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const [codeArgument = '000852.SH', start = '20150101', end = '20241231'] = process.argv.slice(2);
  const indexCodes = parseCodes(codeArgument);
  if (indexCodes.length === 0) {
    throw new Error('No index codes selected');
  }

  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: cfg.minIntervalMs,
  });

  console.log(
    `Syncing index constituents + daily close ${indexCodes.join(', ')} ${start} ~ ${end}\n`,
  );
  for (const indexCode of indexCodes) {
    await syncIndexWeight(client, indexCode, start, end);
    await syncIndexDaily(client, indexCode, start, end);
  }

  const [weightCoverage, dailyCoverage] = await Promise.all([
    prisma.indexWeight.groupBy({
      by: ['indexCode'],
      where: { indexCode: { in: indexCodes } },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
      _count: { _all: true },
      orderBy: { indexCode: 'asc' },
    }),
    prisma.indexDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: indexCodes } },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
      _count: { _all: true },
      orderBy: { tsCode: 'asc' },
    }),
  ]);
  const dailyCoverageByCode = new Map(dailyCoverage.map((row) => [row.tsCode, row]));
  console.table(
    weightCoverage.map((row) => ({
      indexCode: row.indexCode,
      weightStart: row._min.tradeDate,
      weightEnd: row._max.tradeDate,
      weightRows: row._count._all,
      dailyStart: dailyCoverageByCode.get(row.indexCode)?._min.tradeDate,
      dailyEnd: dailyCoverageByCode.get(row.indexCode)?._max.tradeDate,
      dailyRows: dailyCoverageByCode.get(row.indexCode)?._count._all ?? 0,
    })),
  );
  await prisma.$disconnect();
  console.log('✅ Index constituents sync complete');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:index failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
