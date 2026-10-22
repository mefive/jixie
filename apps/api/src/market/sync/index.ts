import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import { getDatabase } from '#infra/database/prisma.js';
import { MARKET_WEATHER_INDICATOR_INDEX_CODES } from '../registry/index-presets.js';
import { syncIndexWeight, syncIndexDaily } from '../indices/sync.js';

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
 * 同步指数成分权重与每日收盘，供证券池及基准计算。
 *
 * Sync index constituents (index_weight) + daily close (index_daily) into the local store.
 * Usage: pnpm --filter api sync index [market-state|CODE,CODE] [start] [end]
 *   default: 000852.SH (CSI 1000) 2015-2024
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const cfg = loadTushareConfig();
  const [codeArgument = '000852.SH', start = '20150101', end = '20241231'] = args;
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
    getDatabase().indexWeight.groupBy({
      by: ['indexCode'],
      where: { indexCode: { in: indexCodes } },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
      _count: { _all: true },
      orderBy: { indexCode: 'asc' },
    }),
    getDatabase().indexDaily.groupBy({
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
  console.log('✅ Index constituents sync complete');
}
