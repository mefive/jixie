import { createHash } from 'node:crypto';
import { getDatabase } from '#infra/database/prisma.js';
import { futureMarketSchema } from './snapshot.js';

const products = ['IF', 'IH', 'IC', 'IM'];

/**
 * 验证所有存续期货合约后才发布不可变的当日输入集合。
 *
 * Validate all live contracts before publishing an immutable daily input set.
 */
export async function publishFutureMarketDate(tradeDate: string): Promise<void> {
  if (await getDatabase().futureMarketPublication.findUnique({ where: { tradeDate } })) {
    return;
  }
  const contracts = await getDatabase().futureContract.findMany({
    where: {
      productCode: { in: products },
      listDate: { lte: tradeDate },
      delistDate: { gte: tradeDate },
    },
    select: { tsCode: true, productCode: true, multiplier: true, listDate: true, delistDate: true },
    orderBy: { tsCode: 'asc' },
  });
  const codes = contracts.map((row) => row.tsCode);
  const [daily, mappings, settlements] = await Promise.all([
    getDatabase().futureDaily.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: {
        tsCode: true,
        tradeDate: true,
        open: true,
        high: true,
        low: true,
        close: true,
        settle: true,
        volume: true,
        amount: true,
        openInterest: true,
      },
      orderBy: { tsCode: 'asc' },
    }),
    getDatabase().futureMapping.findMany({
      where: { tradeDate, continuousCode: { in: products.map((product) => `${product}.CFX`) } },
      select: { continuousCode: true, tradeDate: true, mappedTsCode: true },
      orderBy: { continuousCode: 'asc' },
    }),
    getDatabase().futureSettlement.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, tradeDate: true, longMarginRate: true, shortMarginRate: true },
      orderBy: { tsCode: 'asc' },
    }),
  ]);
  const payload = futureMarketSchema.parse({ contracts, daily, mappings, settlements });
  for (const contract of contracts) {
    const bar = daily.find((row) => row.tsCode === contract.tsCode);
    if (!bar?.open || !bar.close || !bar.settle || bar.openInterest == null) {
      throw new Error(`Incomplete futures market data: ${contract.tsCode}/${tradeDate}`);
    }
  }
  for (const product of products) {
    // Products not yet listed historically need no mapping.
    if (
      contracts.some((contract) => contract.productCode === product) &&
      !mappings.some(
        (mapping) =>
          mapping.continuousCode === `${product}.CFX` && codes.includes(mapping.mappedTsCode),
      )
    ) {
      throw new Error(`Missing futures mapping: ${product}/${tradeDate}`);
    }
  }
  if (!contracts.length) {
    const listed = await getDatabase().futureContract.count({
      where: { productCode: { in: products }, listDate: { lte: tradeDate } },
    });
    const known = await getDatabase().futureContract.count({
      where: { productCode: { in: products } },
    });
    if (listed || !known) {
      throw new Error(`Missing futures contracts on ${tradeDate}`);
    }
  }
  await getDatabase().futureMarketPublication.upsert({
    where: { tradeDate },
    update: {},
    create: {
      tradeDate,
      payload,
      inputHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    },
  });
}

/**
 * 从已发布期货输入还原运行所需行情，避免直接读取未发布切片。
 *
 * Read runtime futures rows from the published input set.
 */
export async function publishedFutureRows(start: string, end: string) {
  const publications = await getDatabase().futureMarketPublication.findMany({
    where: { tradeDate: { gte: start, lte: end } },
    orderBy: { tradeDate: 'asc' },
  });
  const contracts = new Map<
    string,
    ReturnType<typeof futureMarketSchema.parse>['contracts'][number]
  >();
  const result: ReturnType<typeof futureMarketSchema.parse> = {
    contracts: [],
    daily: [],
    mappings: [],
    settlements: [],
  };
  for (const publication of publications) {
    const rows = futureMarketSchema.parse(publication.payload);
    for (const contract of rows.contracts) {
      contracts.set(contract.tsCode, contract);
    }
    result.daily.push(...rows.daily);
    result.mappings.push(...rows.mappings);
    result.settlements.push(...rows.settlements);
  }
  result.contracts = [...contracts.values()];

  return result;
}
