import {
  RESEARCH_SDK_AGENT_CATALOG_V1,
  type FactorAnalysisKind,
  type ResearchAssetTypeV1,
  type ResearchDataCatalogCoverageV1,
  type ResearchDataCatalogFactorReportV1,
  type ResearchDataCatalogInstrumentV1,
  type ResearchDataCatalogRegistryV1,
  type ResearchDataCatalogResultV1,
  type ResearchDataCatalogScopeV1,
  type ResearchMeasureDefinitionV1,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import {
  etfResearchMembership,
  type EtfResearchMembership,
} from '../store/etf-research-registry.js';
import { researchCapabilityCatalog } from './catalog.js';

export interface ResearchDataCatalogQuery {
  query?: string;
  assetType?: ResearchAssetTypeV1;
  scope?: ResearchDataCatalogScopeV1;
  userId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 24;

/** Search platform-governed instruments and return the measures valid for the requested asset type. */
export async function searchResearchDataCatalog(
  input: ResearchDataCatalogQuery = {},
): Promise<ResearchDataCatalogResultV1> {
  const query = input.query?.trim() ?? '';
  const limit = Math.min(50, Math.max(1, input.limit ?? DEFAULT_LIMIT));
  const scope = input.scope ?? 'instruments';
  const assetTypes = input.assetType
    ? ([input.assetType] as const)
    : (['stock', 'etf', 'index', 'future'] as const);
  const measures = researchCapabilityCatalog.measures.filter(
    (measure) =>
      measure.sourceKinds.includes('instrument') &&
      (!input.assetType || measure.assetTypes?.includes(input.assetType)),
  );
  const sdkMethods = RESEARCH_SDK_AGENT_CATALOG_V1.methods
    .filter((method) => method.namespace === (scope === 'factor_reports' ? 'results' : 'data'))
    .map((method) => ({
      qualifiedName: method.qualifiedName,
      name: method.name,
      descriptionZh: method.descriptionZh,
      descriptionEn: method.descriptionEn,
      signature: method.signature,
      example: method.examples[0] ?? '',
      returnColumns:
        method.returns.kind === 'dataframe'
          ? method.returns.columns.map((column) => column.name)
          : [],
    }));

  if (scope === 'factor_reports') {
    return {
      version: 1,
      query,
      sdkMethods,
      instruments: [],
      factorReports: input.userId ? await searchFactorReports(input.userId, query, limit) : [],
      measures: [],
    };
  }

  if (!query) {
    return { version: 1, query, sdkMethods, instruments: [], factorReports: [], measures };
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

  const instruments = uniqueRankedInstruments(candidates, query).slice(0, limit);

  return {
    version: 1,
    query,
    sdkMethods,
    instruments: await attachLocalDataCoverage(instruments),
    factorReports: [],
    measures,
  };
}

async function searchFactorReports(
  userId: string,
  query: string,
  limit: number,
): Promise<ResearchDataCatalogFactorReportV1[]> {
  const factors = await prisma.factor.findMany({
    where: { userId: { in: ['builtin', userId] } },
    select: { key: true, name: true },
  });
  const normalizedQuery = query.toLocaleLowerCase();
  const factorNames = new Map(factors.map((factor) => [factor.key, factor.name]));
  const matchingFactorKeys = normalizedQuery
    ? factors
        .filter((factor) =>
          `${factor.key}\n${factor.name}`.toLocaleLowerCase().includes(normalizedQuery),
        )
        .map((factor) => factor.key)
    : [];
  const reports = await prisma.factorReport.findMany({
    where: {
      userId,
      status: 'done',
      payload: { not: null },
      ...(query
        ? {
            OR: [
              { id: { contains: query } },
              { factor: { contains: query } },
              ...(matchingFactorKeys.length ? [{ factor: { in: matchingFactorKeys } }] : []),
            ],
          }
        : {}),
    },
    select: {
      id: true,
      factor: true,
      analysisKind: true,
      phase: true,
      revealedAt: true,
      createdAt: true,
      computedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  return reports.map((report) => {
    const phase = factorReportPhase(report.phase);
    return {
      kind: 'factor_report',
      id: report.id,
      factor: report.factor,
      factorName: factorNames.get(report.factor) ?? report.factor,
      analysisKind: factorAnalysisKind(report.analysisKind),
      phase,
      sealed: phase === 'holdout' && report.revealedAt === null,
      createdAt: report.createdAt.toISOString(),
      computedAt: report.computedAt?.toISOString() ?? null,
    };
  });
}

function factorReportPhase(value: string): ResearchDataCatalogFactorReportV1['phase'] {
  return value === 'explore' || value === 'holdout' ? value : 'legacy';
}

function factorAnalysisKind(value: string): FactorAnalysisKind {
  switch (value) {
    case 'time_series':
    case 'panel':
    case 'macro_regime':
      return value;
    default:
      return 'cross_sectional';
  }
}

async function attachLocalDataCoverage(
  instruments: ResearchDataCatalogInstrumentV1[],
): Promise<ResearchDataCatalogInstrumentV1[]> {
  const stockCodes = instrumentCodes(instruments, 'stock');
  const etfCodes = instrumentCodes(instruments, 'etf');
  const benchmarkIds = instruments
    .filter(
      (instrument) =>
        instrument.assetType === 'index' &&
        instrument.compatibleMeasureIds.includes('market.cny_close'),
    )
    .map((instrument) => instrument.identifier);
  const indexCodes = instruments
    .filter(
      (instrument) =>
        instrument.assetType === 'index' &&
        !instrument.compatibleMeasureIds.includes('market.cny_close'),
    )
    .map((instrument) => instrument.identifier);
  const continuousFutureCodes = instruments
    .filter((instrument) => instrument.assetType === 'future' && instrument.continuous)
    .map((instrument) => instrument.identifier);
  const futureCodes = instruments
    .filter((instrument) => instrument.assetType === 'future' && !instrument.continuous)
    .map((instrument) => instrument.identifier);
  const [stocks, etfs, indexes, benchmarks, continuousFutures, futures] = await Promise.all([
    prisma.daily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: stockCodes } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    prisma.etfDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: etfCodes } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    prisma.indexDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: indexCodes } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    prisma.marketBenchmarkDaily.groupBy({
      by: ['benchmarkId'],
      where: { benchmarkId: { in: benchmarkIds } },
      _count: { _all: true },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    prisma.futureMapping.groupBy({
      by: ['continuousCode'],
      where: { continuousCode: { in: continuousFutureCodes } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    prisma.futureDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: futureCodes } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
  ]);
  const coverageByInstrument = new Map<string, ResearchDataCatalogCoverageV1>();
  for (const row of stocks) {
    setTradeDateCoverage(coverageByInstrument, `stock:${row.tsCode}`, row);
  }
  for (const row of etfs) {
    setTradeDateCoverage(coverageByInstrument, `etf:${row.tsCode}`, row);
  }
  for (const row of indexes) {
    setTradeDateCoverage(coverageByInstrument, `index:${row.tsCode}`, row);
  }
  for (const row of benchmarks) {
    if (row._min.availableDate && row._max.availableDate) {
      coverageByInstrument.set(`index:${row.benchmarkId}`, {
        status: 'ready',
        observationCount: row._count._all,
        startDate: row._min.availableDate,
        endDate: row._max.availableDate,
        dateBasis: 'availableDate',
      });
    }
  }
  for (const row of continuousFutures) {
    setTradeDateCoverage(coverageByInstrument, `future:${row.continuousCode}`, row);
  }
  for (const row of futures) {
    setTradeDateCoverage(coverageByInstrument, `future:${row.tsCode}`, row);
  }

  return instruments.map((instrument) => {
    const localDataCoverage =
      coverageByInstrument.get(`${instrument.assetType}:${instrument.identifier}`) ??
      missingCoverage();
    const membership =
      instrument.assetType === 'etf' ? etfResearchMembership(instrument.identifier) : null;
    return {
      ...instrument,
      localDataCoverage,
      sdkAccess:
        localDataCoverage.status === 'ready'
          ? { status: 'ready', method: 'data.series' }
          : {
              status: 'not_ready',
              reason: 'source_available_but_local_data_missing',
            },
      ...(instrument.assetType === 'etf'
        ? { researchRegistry: membership ? dataCatalogRegistry(membership) : null }
        : {}),
    };
  });
}

function instrumentCodes(
  instruments: ResearchDataCatalogInstrumentV1[],
  assetType: ResearchAssetTypeV1,
): string[] {
  return instruments
    .filter((instrument) => instrument.assetType === assetType)
    .map((instrument) => instrument.identifier);
}

function setTradeDateCoverage(
  coverageByInstrument: Map<string, ResearchDataCatalogCoverageV1>,
  key: string,
  row: {
    _count: { _all: number };
    _min: { tradeDate: string | null };
    _max: { tradeDate: string | null };
  },
) {
  if (row._min.tradeDate && row._max.tradeDate) {
    coverageByInstrument.set(key, {
      status: 'ready',
      observationCount: row._count._all,
      startDate: row._min.tradeDate,
      endDate: row._max.tradeDate,
      dateBasis: 'tradeDate',
    });
  }
}

function missingCoverage(): ResearchDataCatalogCoverageV1 {
  return {
    status: 'missing',
    reason: 'source_available_but_local_data_missing',
  };
}

function dataCatalogRegistry(membership: EtfResearchMembership): ResearchDataCatalogRegistryV1 {
  return {
    exposureId: membership.exposureId,
    role: membership.role,
    region: membership.region,
    currencyExposure: membership.currencyExposure,
    selectionAsOf: membership.selectionAsOf,
    knownLimitations: membership.knownLimitations,
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
