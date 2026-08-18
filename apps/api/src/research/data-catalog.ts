import type {
  ResearchAssetTypeV1,
  ResearchDataCatalogInstrumentV1,
  ResearchDataCatalogResultV1,
  ResearchMeasureDefinitionV1,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { researchCapabilityCatalog } from './catalog.js';

export interface ResearchDataCatalogQuery {
  query?: string;
  assetType?: ResearchAssetTypeV1;
  limit?: number;
}

const DEFAULT_LIMIT = 24;

/** Search platform-governed instruments and return the measures valid for the requested asset type. */
export async function searchResearchDataCatalog(
  input: ResearchDataCatalogQuery = {},
): Promise<ResearchDataCatalogResultV1> {
  const query = input.query?.trim() ?? '';
  const limit = Math.min(50, Math.max(1, input.limit ?? DEFAULT_LIMIT));
  const assetTypes = input.assetType
    ? ([input.assetType] as const)
    : (['stock', 'etf', 'index', 'future'] as const);
  const measures = researchCapabilityCatalog.measures.filter(
    (measure) =>
      measure.sourceKinds.includes('instrument') &&
      (!input.assetType || measure.assetTypes?.includes(input.assetType)),
  );

  if (!query) {
    return { version: 1, query, instruments: [], measures };
  }

  const [stocks, etfs, indexes, marketBenchmarks, indexCodes, futureMappings, futures] =
    await Promise.all([
      assetTypes.includes('stock')
        ? prisma.stockBasic.findMany({
            where: {
              OR: [
                { tsCode: { contains: query } },
                { symbol: { contains: query } },
                { name: { contains: query } },
              ],
            },
            select: { tsCode: true, name: true, industry: true, market: true },
            take: limit,
          })
        : Promise.resolve([]),
      assetTypes.includes('etf')
        ? prisma.etfBasic.findMany({
            where: {
              OR: [
                { tsCode: { contains: query } },
                { name: { contains: query } },
                { fullName: { contains: query } },
                { indexName: { contains: query } },
              ],
            },
            select: {
              tsCode: true,
              name: true,
              fundType: true,
              indexName: true,
              exchange: true,
            },
            take: limit,
          })
        : Promise.resolve([]),
      assetTypes.includes('index')
        ? prisma.indexBenchmark.findMany({
            where: {
              OR: [
                { tsCode: { contains: query } },
                { symbol: { contains: query } },
                { name: { contains: query } },
                { fullName: { contains: query } },
              ],
            },
            select: { tsCode: true, name: true, fullName: true, indexType: true },
            take: limit,
          })
        : Promise.resolve([]),
      assetTypes.includes('index')
        ? prisma.marketBenchmark.findMany({
            where: {
              OR: [
                { id: { contains: query } },
                { providerCode: { contains: query } },
                { nameZh: { contains: query } },
                { nameEn: { contains: query } },
              ],
            },
            select: {
              id: true,
              providerCode: true,
              nameZh: true,
              nameEn: true,
              market: true,
              currency: true,
            },
            take: limit,
          })
        : Promise.resolve([]),
      assetTypes.includes('index')
        ? prisma.indexDaily.findMany({
            where: { tsCode: { contains: query } },
            select: { tsCode: true },
            distinct: ['tsCode'],
            take: limit,
          })
        : Promise.resolve([]),
      assetTypes.includes('future')
        ? prisma.futureMapping.findMany({
            where: { continuousCode: { contains: query } },
            select: { continuousCode: true },
            distinct: ['continuousCode'],
            take: limit,
          })
        : Promise.resolve([]),
      assetTypes.includes('future')
        ? prisma.futureContract.findMany({
            where: {
              OR: [
                { tsCode: { contains: query } },
                { symbol: { contains: query } },
                { name: { contains: query } },
                { productCode: { contains: query } },
              ],
            },
            select: {
              tsCode: true,
              name: true,
              productCode: true,
              exchange: true,
              deliveryMonth: true,
            },
            take: limit,
          })
        : Promise.resolve([]),
    ]);

  const knownIndexCodes = new Set(indexes.map((item) => item.tsCode));
  const candidates: ResearchDataCatalogInstrumentV1[] = [
    ...stocks.map((item) =>
      instrument('stock', item.tsCode, item.name, measures, compact([item.industry, item.market])),
    ),
    ...etfs.map((item) =>
      instrument(
        'etf',
        item.tsCode,
        item.name,
        measures,
        compact([item.fundType, item.indexName, item.exchange]),
      ),
    ),
    ...indexes.map((item) =>
      instrument(
        'index',
        item.tsCode,
        item.name,
        measures,
        compact([item.indexType]),
        item.fullName ?? undefined,
      ),
    ),
    ...marketBenchmarks.map((item) =>
      instrument(
        'index',
        item.id,
        item.nameZh,
        measures,
        compact([item.market, item.currency, item.providerCode]),
        undefined,
        item.nameEn,
        true,
      ),
    ),
    ...indexCodes
      .filter((item) => !knownIndexCodes.has(item.tsCode))
      .map((item) => instrument('index', item.tsCode, item.tsCode, measures)),
    ...futureMappings.map((item) => ({
      ...instrument('future', item.continuousCode, `${item.continuousCode} 主力连续`, measures, [
        'continuous',
      ]),
      continuous: true,
    })),
    ...futures.map((item) =>
      instrument(
        'future',
        item.tsCode,
        item.name,
        measures,
        compact([item.productCode, item.exchange, item.deliveryMonth]),
      ),
    ),
  ];

  return {
    version: 1,
    query,
    instruments: uniqueRankedInstruments(candidates, query).slice(0, limit),
    measures,
  };
}

function instrument(
  assetType: ResearchAssetTypeV1,
  identifier: string,
  nameZh: string,
  measures: ResearchMeasureDefinitionV1[],
  tags: string[] = [],
  description?: string,
  nameEn?: string,
  supportsCnyClose = false,
): ResearchDataCatalogInstrumentV1 {
  return {
    kind: 'instrument',
    assetType,
    identifier,
    nameZh,
    ...(nameEn ? { nameEn } : {}),
    ...(description ? { description } : {}),
    tags,
    compatibleMeasureIds: measures
      .filter(
        (measure) =>
          measure.assetTypes?.includes(assetType) &&
          (measure.id !== 'market.cny_close' || supportsCnyClose),
      )
      .map((measure) => measure.id),
  };
}

function uniqueRankedInstruments(
  items: ResearchDataCatalogInstrumentV1[],
  query: string,
): ResearchDataCatalogInstrumentV1[] {
  const unique = new Map<string, ResearchDataCatalogInstrumentV1>();
  for (const item of items) {
    unique.set(`${item.assetType}:${item.identifier}`, item);
  }
  return [...unique.values()].sort(
    (left, right) => catalogScore(right, query) - catalogScore(left, query),
  );
}

function catalogScore(item: ResearchDataCatalogInstrumentV1, query: string): number {
  const normalizedQuery = query.toLocaleLowerCase();
  const identifier = item.identifier.toLocaleLowerCase();
  const names = [item.nameZh, item.nameEn ?? ''].map((value) => value.toLocaleLowerCase());
  const tags = item.tags.map((value) => value.toLocaleLowerCase());
  if (identifier === normalizedQuery) {
    return 120;
  }
  if (names.includes(normalizedQuery)) {
    return 110;
  }
  if (
    identifier.startsWith(normalizedQuery) ||
    names.some((value) => value.startsWith(normalizedQuery))
  ) {
    return 70;
  }
  if (tags.includes(normalizedQuery)) {
    return 40;
  }
  return 10;
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}
