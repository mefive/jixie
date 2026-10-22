import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { getDatabase } from '#infra/database/prisma.js';
import { MAJOR_INDEX_DAILY_CODES } from '../registry/index-presets.js';
import { syncIndexDaily } from '../indices/sync.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

function currentDate(): string {
  return stagingNow().toISOString().slice(0, 10).replaceAll('-', '');
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
 * 仅同步指数收盘序列，不拉取成分权重。
 *
 * Sync index close series without fetching constituent weights.
 * Usage: pnpm --filter api sync index-daily [start] [end] [major|CODE,CODE]
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const config = loadTushareConfig();
  const [start = '19900101', end = currentDate(), codeArgument = 'major'] = args;
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

  const coverage = await getDatabase().indexDaily.groupBy({
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
