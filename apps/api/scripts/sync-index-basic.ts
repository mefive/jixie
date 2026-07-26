import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { MAJOR_INDEX_DAILY_BASIC_CODES } from '../src/store/index-presets.js';
import { syncIndexDailyBasic } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

function currentDate(): string {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

function parseCodes(value: string): string[] {
  if (value === 'major') {
    return [...MAJOR_INDEX_DAILY_BASIC_CODES];
  }
  return value
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
}

/**
 * Sync broad-market index daily valuation metrics.
 * Usage: pnpm --filter api sync:index-basic [start] [end] [major|CODE,CODE]
 */
async function main(): Promise<void> {
  const config = loadTushareConfig();
  const [start = '20040101', end = currentDate(), codeArgument = 'major'] = process.argv.slice(2);
  const codes = parseCodes(codeArgument);
  if (codes.length === 0) {
    throw new Error('No index codes selected');
  }
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });

  console.log(`Syncing index_dailybasic ${codes.join(', ')} ${start} ~ ${end}\n`);
  await syncIndexDailyBasic(client, codes, start, end);

  const coverage = await prisma.indexDailyBasic.groupBy({
    by: ['tsCode'],
    _min: { tradeDate: true },
    _max: { tradeDate: true },
    _count: { _all: true },
    orderBy: { tsCode: 'asc' },
  });
  console.table(
    coverage.map((row) => ({
      tsCode: row.tsCode,
      start: row._min.tradeDate,
      end: row._max.tradeDate,
      rows: row._count._all,
    })),
  );
  console.log('Index daily valuation sync complete');
}

main()
  .catch((error: unknown) => {
    console.error(
      'Index daily valuation sync failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
