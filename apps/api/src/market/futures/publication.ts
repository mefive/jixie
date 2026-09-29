import { createHash } from 'node:crypto';
import { prisma } from '#infra/database/prisma.js';
import { futureMarketSchema } from './snapshot.js';

const products = ['IF', 'IH', 'IC', 'IM'];

/** Validate all live contracts before publishing an immutable daily input set. */
export async function publishFutureMarketDate(tradeDate: string): Promise<void> {
  if (await prisma.futureMarketPublication.findUnique({ where: { tradeDate } })) {
    return;
  }
  const contracts = await prisma.futureContract.findMany({
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
    prisma.futureDaily.findMany({
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
    prisma.futureMapping.findMany({
      where: { tradeDate, continuousCode: { in: products.map((product) => `${product}.CFX`) } },
      select: { continuousCode: true, tradeDate: true, mappedTsCode: true },
      orderBy: { continuousCode: 'asc' },
    }),
    prisma.futureSettlement.findMany({
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
    const listed = await prisma.futureContract.count({
      where: { productCode: { in: products }, listDate: { lte: tradeDate } },
    });
    const known = await prisma.futureContract.count({ where: { productCode: { in: products } } });
    if (listed || !known) {
      throw new Error(`Missing futures contracts on ${tradeDate}`);
    }
  }
  await prisma.futureMarketPublication.upsert({
    where: { tradeDate },
    update: {},
    create: {
      tradeDate,
      payload,
      inputHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    },
  });
}

export async function publishedFutureRows(start: string, end: string) {
  const publications = await prisma.futureMarketPublication.findMany({
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
