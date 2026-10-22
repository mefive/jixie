import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { getDatabase } from '#infra/database/prisma.js';
import { syncEtfShareSizeRange } from '../etfs/sync.js';
import { MAJOR_ETF_CODES } from '../registry/etf-presets.js';
import { ETF_RESEARCH_CODES } from '../registry/etf-research-registry.js';
import { syncEtfBasic, syncEtfDaily } from '../etfs/history-sync.js';
import { syncTradeCal } from '../calendar/sync.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

/**
 * 解析并去重 ETF 代码参数，拒绝空或非法代码。
 *
 * Parse and deduplicate ETF codes and reject invalid input.
 */
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
 * 同步 ETF 元数据及选定区间的日线和复权因子。
 *
 * Sync ETF metadata plus selected daily bars/adjustment factors.
 * Usage: pnpm --filter api sync etf [start] [end] [registry|major|CODE,CODE] [refresh]
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const config = loadTushareConfig();
  const currentDate = stagingNow().toISOString().slice(0, 10).replaceAll('-', '');
  const [start = '20150101', end = currentDate, selector = 'registry', refreshArg] = args;
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
    etf_basic: await getDatabase().etfBasic.count(),
    etf_daily: await getDatabase().etfDaily.count(),
    etf_adj_factor: await getDatabase().etfAdjFactor.count(),
    etf_share_size: await getDatabase().etfShareSize.count(),
  });
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
