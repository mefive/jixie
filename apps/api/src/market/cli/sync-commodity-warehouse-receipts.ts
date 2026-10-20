import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { syncCommodityWarehouseReceipts } from '../commodity/commodity-warehouse-receipts.js';
import { COMMODITY_FUTURE_PRODUCT_CODES } from '../commodity/commodity-futures.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { prisma } from '#infra/database/prisma.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

/**
 * 同步已配置商品的交易所仓单聚合，供研究数据读取。
 *
 * Sync research-only AU/CU/SC/M exchange warehouse-receipt aggregates.
 * Usage: pnpm --filter api sync commodity-warehouse-receipts [start] [end]
 */
async function main(): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const config = loadTushareConfig();
  const currentDate = stagingNow().toISOString().slice(0, 10).replaceAll('-', '');
  const [start = `${stagingNow().getUTCFullYear()}0101`, end = currentDate] = process.argv.slice(2);
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
      rows: await prisma.commodityWarehouseReceipt.count({
        where: { productCode, tradeDate: { gte: start, lte: end } },
      }),
    })),
  );
  console.table(productCounts);
  console.log(`Stored ${total} daily aggregates; warehouse receipts remain research-only.`);
  await prisma.$disconnect();
}

await main().catch(async (error: unknown) => {
  console.error(
    'sync commodity-warehouse-receipts failed:',
    error instanceof Error ? error.message : error,
  );
  await prisma.$disconnect();
  process.exitCode = 1;
});
