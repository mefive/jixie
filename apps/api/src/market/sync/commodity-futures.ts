import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { getDatabase } from '#infra/database/prisma.js';
import {
  COMMODITY_FUTURE_PRODUCT_CODES,
  COMMODITY_FUTURE_SPECS,
} from '../commodity/commodity-futures.js';
import { syncCommodityFutureContracts, syncCommodityFutureDaily } from '../futures/sync.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

/**
 * 同步已配置商品实际交割合约与原始结算数据，供商品研究使用。
 *
 * Sync research-only AU/CU/SC/M actual contracts and raw settlements.
 * Usage: pnpm --filter api sync commodity-futures [start] [end]
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
    `Syncing research-only commodity futures ${COMMODITY_FUTURE_PRODUCT_CODES.join('/')} ${start} ~ ${end}`,
  );
  await syncCommodityFutureContracts(client);
  await syncCommodityFutureDaily(client, start, end);

  const productCounts = await Promise.all(
    COMMODITY_FUTURE_SPECS.map(async (spec) => ({
      product: `${spec.productCode}.${spec.exchange}`,
      contracts: await getDatabase().futureContract.count({
        where: { productCode: spec.productCode, exchange: spec.exchange },
      }),
      dailyRows: await getDatabase().futureDaily.count({
        where: {
          tsCode: {
            in: (
              await getDatabase().futureContract.findMany({
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
}
