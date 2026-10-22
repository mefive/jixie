import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { getDatabase } from '#infra/database/prisma.js';
import { MAJOR_INDEX_DAILY_BASIC_CODES } from '../registry/index-presets.js';
import { syncIndexDailyBasic } from '../indices/sync.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

function currentDate(): string {
  return stagingNow().toISOString().slice(0, 10).replaceAll('-', '');
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
 * 同步宽基指数每日估值指标。
 *
 * Sync broad-market index daily valuation metrics.
 * Usage: pnpm --filter api sync index-basic [start] [end] [major|CODE,CODE]
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const config = loadTushareConfig();
  const [start = '20040101', end = currentDate(), codeArgument = 'major'] = args;
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

  const coverage = await getDatabase().indexDailyBasic.groupBy({
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
