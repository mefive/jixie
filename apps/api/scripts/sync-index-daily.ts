import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { MAJOR_INDEX_DAILY_CODES } from '../src/store/index-presets.js';
import { syncIndexDaily } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

function currentDate(): string {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

function parseCodes(value: string): string[] {
  if (value === 'major') {
    return [...MAJOR_INDEX_DAILY_CODES];
  }

  return value
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Sync index close series without fetching constituent weights.
 * Usage: pnpm --filter api sync:index-daily [start] [end] [major|CODE,CODE]
 */
async function main(): Promise<void> {
  const config = loadTushareConfig();
  const [start = '19900101', end = currentDate(), codeArgument = 'major'] = process.argv.slice(2);
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }

  const codes = parseCodes(codeArgument);
  if (codes.length === 0) {
    throw new Error('No index codes selected');
  }

  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });

  console.log(`Syncing index_daily closes ${codes.join(', ')} ${start} ~ ${end}\n`);
  for (const code of codes) {
    await syncIndexDaily(client, code, start, end);
  }

  const coverage = await prisma.indexDaily.groupBy({
    by: ['tsCode'],
    where: { tsCode: { in: codes } },
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
  console.log('Index daily close sync complete');
}

main()
  .catch((error: unknown) => {
    console.error(
      'Index daily close sync failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
