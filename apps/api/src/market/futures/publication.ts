import { MarketSourcePendingError } from '../errors.js';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { getDatabase } from '#infra/database/prisma.js';
import { futureMarketSchema } from './snapshot.js';

const products = ['IF', 'IH', 'IC', 'IM'];

/**
 * 验证所有存续期货合约后才发布不可变的当日输入集合。
 *
 * Validate all live contracts before publishing an immutable daily input set.
 */
export async function publishFutureMarketDate(
  tradeDate: string,
  database: Prisma.TransactionClient = getDatabase(),
): Promise<void> {
  const contracts = await database.futureContract.findMany({
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
    database.futureDaily.findMany({
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
    database.futureMapping.findMany({
      where: { tradeDate, continuousCode: { in: products.map((product) => `${product}.CFX`) } },
      select: { continuousCode: true, tradeDate: true, mappedTsCode: true },
      orderBy: { continuousCode: 'asc' },
    }),
    database.futureSettlement.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, tradeDate: true, longMarginRate: true, shortMarginRate: true },
      orderBy: { tsCode: 'asc' },
    }),
  ]);
  for (const product of products) {
    const metadata = await database.datasetSyncPartition.findFirst({
      where: {
        dataset: 'future-contracts',
        scope: `CFFEX|${product}`,
        status: 'complete',
        endDate: { gte: tradeDate },
      },
    });
    if (!metadata) {
      throw new MarketSourcePendingError(`Unverified futures catalog: ${product}/${tradeDate}`);
    }
  }
  const requirements = [
    ...codes.flatMap((scope) =>
      ['future-prices', 'future-settlements'].map((dataset) => ({ dataset, scope })),
    ),
    ...products
      .filter((product) => contracts.some((contract) => contract.productCode === product))
      .map((product) => ({ dataset: 'future-mappings', scope: `${product}.CFX` })),
  ];
  for (const requirement of requirements) {
    const coverage = await database.datasetSyncPartition.findFirst({
      where: {
        ...requirement,
        status: 'complete',
        policyVersion: 'sync-v1',
        startDate: { lte: tradeDate },
        endDate: { gte: tradeDate },
      },
    });
    if (!coverage) {
      throw new MarketSourcePendingError(
        `Unverified futures input: ${requirement.dataset}/${requirement.scope}/${tradeDate}`,
      );
    }
  }
  const payload = futureMarketSchema.parse({ contracts, daily, mappings, settlements });
  for (const contract of contracts) {
    const bar = daily.find((row) => row.tsCode === contract.tsCode);
    const settlement = settlements.find((row) => row.tsCode === contract.tsCode);
    if (
      !bar?.open ||
      !bar.close ||
      !bar.settle ||
      bar.openInterest == null ||
      settlement?.longMarginRate == null ||
      settlement.shortMarginRate == null
    ) {
      throw new MarketSourcePendingError(
        `Incomplete futures market data: ${contract.tsCode}/${tradeDate}`,
      );
    }
  }
  for (const product of products) {
    // 历史上尚未上市的品种不需要映射。
    // Historically unlisted products need no mapping.
    if (
      contracts.some((contract) => contract.productCode === product) &&
      !mappings.some(
        (mapping) =>
          mapping.continuousCode === `${product}.CFX` && codes.includes(mapping.mappedTsCode),
      )
    ) {
      throw new MarketSourcePendingError(`Missing futures mapping: ${product}/${tradeDate}`);
    }
  }
  if (!contracts.length) {
    const listed = await database.futureContract.count({
      where: { productCode: { in: products }, listDate: { lte: tradeDate } },
    });
    const known = await database.futureContract.count({
      where: { productCode: { in: products } },
    });
    if (listed || !known) {
      throw new MarketSourcePendingError(`Missing futures contracts on ${tradeDate}`);
    }
  }
  const inputHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const revision =
    (await database.marketDataState.findUnique({ where: { key: 'global' } }))?.revision ?? 0;
  await database.futureMarketRevision.upsert({
    where: { tradeDate_inputHash: { tradeDate, inputHash } },
    create: { tradeDate, inputHash, dataRevision: revision, payload },
    update: { dataRevision: revision },
  });
  await database.futureMarketPublication.upsert({
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
  const dates = await readyFutureDates(start, end);
  const historical = await getDatabase().futureMarketPublication.findMany({
    where: { tradeDate: { in: dates } },
    orderBy: { tradeDate: 'asc' },
  });
  const revisions = await getDatabase().futureMarketRevision.findMany({
    where: { tradeDate: { in: dates } },
    orderBy: [{ tradeDate: 'asc' }, { dataRevision: 'asc' }],
  });
  const byDate = new Map(
    historical.map((publication) => [publication.tradeDate, publication.payload]),
  );
  for (const revision of revisions) {
    byDate.set(revision.tradeDate, revision.payload);
  }
  const publications = [...byDate]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, payload]) => ({ payload }));
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

/**
 * 只有完整输入和当前代次相符的日期可供新计算读取；冻结账户仍读取自身快照。
 *
 * New computations read only complete current-generation inputs; frozen accounts retain their own
 * snapshots.
 */
export async function readyFutureDates(start: string, end: string): Promise<string[]> {
  const states = await getDatabase().marketCalculationState.findMany({
    where: { kind: 'future-publication', status: 'ready', date: { gte: start, lte: end } },
    select: { date: true, generation: true, readyGeneration: true },
  });

  return states
    .filter((state) => state.generation === state.readyGeneration)
    .map((state) => state.date);
}
