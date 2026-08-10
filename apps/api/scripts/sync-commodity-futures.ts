import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import {
  COMMODITY_FUTURE_PRODUCT_CODES,
  COMMODITY_FUTURE_SPECS,
} from '../src/commodity/commodity-futures.js';
import { syncCommodityFutureContracts, syncCommodityFutureDaily } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

/**
 * Sync research-only AU/CU/SC/M actual contracts and raw settlements.
 * Usage: pnpm --filter api sync:commodity-futures [start] [end]
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
    `Syncing research-only commodity futures ${COMMODITY_FUTURE_PRODUCT_CODES.join('/')} ${start} ~ ${end}`,
  );
  await syncCommodityFutureContracts(client);
  await syncCommodityFutureDaily(client, start, end);

  const productCounts = await Promise.all(
    COMMODITY_FUTURE_SPECS.map(async (spec) => ({
      product: `${spec.productCode}.${spec.exchange}`,
      contracts: await prisma.futureContract.count({
        where: { productCode: spec.productCode, exchange: spec.exchange },
      }),
      dailyRows: await prisma.futureDaily.count({
        where: {
          tsCode: {
            in: (
              await prisma.futureContract.findMany({
                where: { productCode: spec.productCode, exchange: spec.exchange },
                select: { tsCode: true },
              })
            ).map((contract) => contract.tsCode),
          },
          tradeDate: { gte: start, lte: end },
        },
      }),
    })),
  );
  console.table(productCounts);
  console.log('Commodity futures remain research-only; no trading capability was enabled.');
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error('sync:commodity-futures failed:', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
