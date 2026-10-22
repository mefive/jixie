import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { syncCommodityHoldingPositions } from '../commodity/commodity-holding-positions.js';
import { COMMODITY_HOLDING_SPECS } from '../commodity/commodity-futures.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { addDays } from '#date';
import { syncTradeCal } from '../calendar/sync.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

/**
 * 同步代表合约的会员排名聚合，保留排名子集口径。
 *
 * Sync research-only ranked-member aggregates for representative AU/CU/M contracts.
 * Usage: pnpm --filter api sync commodity-holdings [start] [end]
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
  await syncTradeCal(client, startDate, addDays(endDate, 14));
  console.log(
    `Syncing research-only commodity holding rankings ${COMMODITY_HOLDING_SPECS.map((specification) => specification.productCode).join('/')} ${startDate} ~ ${endDate}`,
  );
  const summary = await syncCommodityHoldingPositions(client, startDate, endDate);
  console.log('Commodity holding position sync complete:', summary);
}
