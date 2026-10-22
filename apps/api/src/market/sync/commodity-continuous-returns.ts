import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { syncCommodityContinuousReturns } from '../commodity/commodity-continuous-returns.js';
import { auditCommodityContinuousReturns } from '../commodity/commodity-continuous-return-quality.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { addDays } from '#date';
import { syncTradeCal } from '../calendar/sync.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

/**
 * 同步商品主力映射并重建仅用于研究的收益账本，不生成可交易连续价格。
 *
 * Sync Tushare main mappings and rebuild the audited research-only commodity return ledger.
 * Usage: pnpm --filter api sync commodity-continuous [start] [end]
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const currentDate = stagingNow().toISOString().slice(0, 10).replaceAll('-', '');
  const [startDate = '20150105', endDate = currentDate] = args;
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const contextStart = addDays(startDate, -21);
  await syncTradeCal(client, contextStart, addDays(endDate, 14));
  const summary = await syncCommodityContinuousReturns(client, startDate, endDate);
  const quality = await auditCommodityContinuousReturns({ startDate, endDate });
  console.log('Commodity continuous-return sync complete:', summary);
  console.log('Commodity continuous-return quality:', quality);
  if (quality.status === 'error') {
    throw new Error(quality.errors.join('; '));
  }
}
