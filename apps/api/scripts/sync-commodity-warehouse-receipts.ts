import { syncCommodityWarehouseReceipts } from '../src/commodity/commodity-warehouse-receipts.js';
import { COMMODITY_FUTURE_PRODUCT_CODES } from '../src/commodity/commodity-futures.js';
import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { TushareClient } from '../src/tushare/client.js';

/**
 * Sync research-only AU/CU/SC/M exchange warehouse-receipt aggregates.
 * Usage: pnpm --filter api sync:commodity-warehouse-receipts [start] [end]
 */
async function main(): Promise<void> {
  const config = loadTushareConfig();
  const currentDate = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const [start = `${new Date().getUTCFullYear()}0101`, end = currentDate] = process.argv.slice(2);
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

main().catch(async (error: unknown) => {
  console.error(
    'sync:commodity-warehouse-receipts failed:',
    error instanceof Error ? error.message : error,
  );
  await prisma.$disconnect();
  process.exitCode = 1;
});
