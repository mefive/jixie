import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { syncCommodityWarehouseReceipts } from '../commodity/commodity-warehouse-receipts.js';
import { COMMODITY_FUTURE_PRODUCT_CODES } from '../commodity/commodity-futures.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { getDatabase } from '#infra/database/prisma.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

/**
 * 同步已配置商品的交易所仓单聚合，供研究数据读取。
 *
 * Sync research-only AU/CU/SC/M exchange warehouse-receipt aggregates.
 * Usage: pnpm --filter api sync commodity-warehouse-receipts [start] [end]
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const config = loadTushareConfig();
  const currentDate = stagingNow().toISOString().slice(0, 10).replaceAll('-', '');
  const [start = `${stagingNow().getUTCFullYear()}0101`, end = currentDate] = args;
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });

  console.log(
    `Syncing research-only commodity warehouse receipts ${COMMODITY_FUTURE_PRODUCT_CODES.join('/')} ${start} ~ ${end}`,
  );
  const total = await syncCommodityWarehouseReceipts(client, start, end);
  const productCounts = await Promise.all(
    COMMODITY_FUTURE_PRODUCT_CODES.map(async (productCode) => ({
      productCode,
      rows: await getDatabase().commodityWarehouseReceipt.count({
        where: { productCode, tradeDate: { gte: start, lte: end } },
      }),
    })),
  );
  console.table(productCounts);
  console.log(`Stored ${total} daily aggregates; warehouse receipts remain research-only.`);
}
