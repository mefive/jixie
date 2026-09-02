import {
  RESEARCH_EQUITY_UNIVERSE_SUGGESTIONS_V1,
  RESEARCH_SDK_AGENT_CATALOG_V1,
  RESEARCH_YIELD_CURVE_CODES_V1,
  RESEARCH_YIELD_TENORS_V1,
  type FactorAnalysisKind,
  type ResearchAssetTypeV1,
  type ResearchDataCatalogBacktestReportV1,
  type ResearchDataCatalogCoverageV1,
  type ResearchDataCatalogDatasetCoverageV1,
  type ResearchDataCatalogDatasetV1,
  type ResearchDataCatalogFactorReportV1,
  type ResearchDataCatalogInstrumentV1,
  type ResearchDataCatalogRegistryV1,
  type ResearchDataCatalogResultV1,
  type ResearchDataCatalogScopeV1,
  type ResearchMeasureDefinitionV1,
} from '@jixie/shared';
import { Prisma } from '@prisma/client';
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
    .filter((method) => catalogMethodNames(scope).includes(method.qualifiedName))
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
      datasets: [],
      factorReports: input.userId ? await searchFactorReports(input.userId, query, limit) : [],
      backtestReports: [],
      measures: [],
    };
  }

  if (scope === 'backtest_reports') {
    return {
      version: 1,
      query,
      sdkMethods,
      instruments: [],
      datasets: [],
      factorReports: [],
      backtestReports: input.userId ? await searchBacktestReports(input.userId, query, limit) : [],
      measures: [],
    };
  }

  if (scope === 'datasets') {
    return {
      version: 1,
      query,
      sdkMethods,
      instruments: [],
      datasets: await searchDatasets(query, limit),
      factorReports: [],
      backtestReports: [],
      measures: [],
    };
  }

  if (!query) {
    return {
      version: 1,
      query,
      sdkMethods,
      instruments: [],
      datasets: [],
      factorReports: [],
      backtestReports: [],
      measures,
    };
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
    datasets: [],
    factorReports: [],
    backtestReports: [],
    measures,
  };
}

function catalogMethodNames(scope: ResearchDataCatalogScopeV1): string[] {
  switch (scope) {
    case 'datasets':
      return ['data.cross_section', 'data.panel', 'data.yield_curve'];
    case 'factor_reports':
      return ['results.factor_report'];
    case 'backtest_reports':
      return ['results.backtest_report'];
    default:
      return ['data.series'];
  }
}

async function searchDatasets(
  query: string,
  limit: number,
): Promise<ResearchDataCatalogDatasetV1[]> {
  const indexCodes = RESEARCH_EQUITY_UNIVERSE_SUGGESTIONS_V1.filter((value) =>
    value.startsWith('index:'),
  ).map((value) => value.slice('index:'.length));
  const [dailyStart, dailyEnd, dailyBasicStart, dailyBasicEnd, indexWeights, yieldCurves] =
    await Promise.all([
      prisma.daily.findFirst({ orderBy: { tradeDate: 'asc' }, select: { tradeDate: true } }),
      prisma.daily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
      prisma.dailyBasic.findFirst({ orderBy: { tradeDate: 'asc' }, select: { tradeDate: true } }),
      prisma.dailyBasic.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
      prisma.indexWeight.groupBy({
        by: ['indexCode'],
        where: { indexCode: { in: indexCodes } },
        _min: { tradeDate: true },
        _max: { tradeDate: true },
      }),
      prisma.yieldCurvePoint.groupBy({
        by: ['curveCode', 'termYears'],
        where: { curveCode: { in: [...RESEARCH_YIELD_CURVE_CODES_V1] } },
        _min: { availableDate: true },
        _max: { availableDate: true },
      }),
    ]);

  const equityCoverage = intersectDatasetCoverage([
    [dailyStart?.tradeDate, dailyEnd?.tradeDate],
    [dailyBasicStart?.tradeDate, dailyBasicEnd?.tradeDate],
  ]);
  const weightCoverage = new Map(
    indexWeights.map((row) => [row.indexCode, [row._min.tradeDate, row._max.tradeDate] as const]),
  );
  const equityDatasets = RESEARCH_EQUITY_UNIVERSE_SUGGESTIONS_V1.flatMap((universe) => {
    const meta = equityUniverseMeta(universe);
    const indexCoverage = universe.startsWith('index:')
      ? weightCoverage.get(universe.slice('index:'.length))
      : undefined;
    const coverage = indexCoverage
      ? intersectDatasetCoverage([
          equityCoverage.status === 'ready'
            ? [equityCoverage.startDate, equityCoverage.endDate]
            : [undefined, undefined],
          indexCoverage,
        ])
      : equityCoverage;
    return [
      {
        kind: 'dataset' as const,
        id: `data.cross_section:${universe}`,
        method: 'data.cross_section' as const,
        universe,
        nameZh: `${meta.nameZh} PIT 截面`,
        nameEn: `${meta.nameEn} PIT cross-section`,
        descriptionZh: '按指定交易日读取点时可得的估值与交易指标。',
        descriptionEn: 'Point-in-time valuation and trading measures on one trading date.',
        tags: [...meta.tags, 'PIT', 'cross-section'],
        localDataCoverage: coverage,
      },
      {
        kind: 'dataset' as const,
        id: `data.panel:${universe}`,
        method: 'data.panel' as const,
        universe,
        nameZh: `${meta.nameZh}月末面板`,
        nameEn: `${meta.nameEn} month-end panel`,
        descriptionZh: '按月末快照读取点时成分、估值与交易指标。',
        descriptionEn: 'Month-end point-in-time membership, valuation, and trading measures.',
        tags: [...meta.tags, 'PIT', 'panel', 'month-end'],
        localDataCoverage: coverage,
      },
    ];
  });

  const yieldCoverage = new Map(
    yieldCurves.map((row) => [
      `${row.curveCode}:${row.termYears}`,
      [row._min.availableDate, row._max.availableDate] as const,
    ]),
  );
  const yieldDatasets = RESEARCH_YIELD_CURVE_CODES_V1.flatMap((curve) =>
    RESEARCH_YIELD_TENORS_V1.flatMap((tenor) => {
      const range = yieldCoverage.get(`${curve}:${yieldTenorYears(tenor)}`);
      if (!range?.[0] || !range[1]) {
        return [];
      }
      const nominal = curve === 'us_treasury_nominal';
      return [
        {
          kind: 'dataset' as const,
          id: `data.yield_curve:${curve}:${tenor}`,
          method: 'data.yield_curve' as const,
          curve,
          tenor,
          nameZh: `美国国债${nominal ? '名义' : '实际'}收益率 ${tenor}`,
          nameEn: `US Treasury ${nominal ? 'nominal' : 'real'} yield ${tenor}`,
          descriptionZh: `按可得日期治理的美国国债${nominal ? '名义' : '实际'}收益率。`,
          descriptionEn: `Availability-date governed US Treasury ${nominal ? 'nominal' : 'real'} yield.`,
          tags: ['US Treasury', nominal ? 'nominal' : 'real', tenor, 'yield'],
          localDataCoverage: readyDatasetCoverage(range[0], range[1], 'availableDate'),
        },
      ];
    }),
  );
  const datasets = [...equityDatasets, ...yieldDatasets];
  const normalizedQuery = query.toLocaleLowerCase();
  return datasets
    .filter((dataset) => !normalizedQuery || datasetSearchText(dataset).includes(normalizedQuery))
    .slice(0, limit);
}

function equityUniverseMeta(universe: string): { nameZh: string; nameEn: string; tags: string[] } {
  switch (universe) {
    case 'index:000300.SH':
      return { nameZh: '沪深 300', nameEn: 'CSI 300', tags: ['沪深300', 'CSI 300'] };
    case 'index:000905.SH':
      return { nameZh: '中证 500', nameEn: 'CSI 500', tags: ['中证500', 'CSI 500'] };
    case 'index:000852.SH':
      return { nameZh: '中证 1000', nameEn: 'CSI 1000', tags: ['中证1000', 'CSI 1000'] };
    default:
      return { nameZh: '全 A 股', nameEn: 'China A-shares', tags: ['全A', 'China A'] };
  }
}

function yieldTenorYears(tenor: (typeof RESEARCH_YIELD_TENORS_V1)[number]): number {
  switch (tenor) {
    case '1M':
      return 1 / 12;
    case '2M':
      return 1 / 6;
    case '3M':
      return 1 / 4;
    case '6M':
      return 1 / 2;
    default:
      return Number.parseInt(tenor, 10);
  }
}

function datasetSearchText(dataset: ResearchDataCatalogDatasetV1): string {
  return [
    dataset.id,
    dataset.method,
    dataset.nameZh,
    dataset.nameEn,
    dataset.descriptionZh,
    dataset.descriptionEn,
    ...dataset.tags,
    ...(dataset.method === 'data.yield_curve'
      ? [dataset.curve, dataset.tenor]
      : [dataset.universe]),
  ]
    .join('\n')
    .toLocaleLowerCase();
}

function intersectDatasetCoverage(
  ranges: ReadonlyArray<readonly [string | null | undefined, string | null | undefined]>,
): ResearchDataCatalogDatasetCoverageV1 {
  if (ranges.some(([start, end]) => !start || !end)) {
    return missingDatasetCoverage();
  }
  const starts = ranges.map(([start]) => start as string);
  const ends = ranges.map(([, end]) => end as string);
  const start = starts.sort().at(-1);
  const end = ends.sort()[0];
  return start && end && start <= end
    ? readyDatasetCoverage(start, end, 'tradeDate')
    : missingDatasetCoverage();
}

function readyDatasetCoverage(
  startDate: string,
  endDate: string,
  dateBasis: 'tradeDate' | 'availableDate',
): ResearchDataCatalogDatasetCoverageV1 {
  return { status: 'ready', startDate, endDate, dateBasis };
}

function missingDatasetCoverage(): ResearchDataCatalogDatasetCoverageV1 {
  return { status: 'missing', reason: 'source_available_but_local_data_missing' };
}

async function searchBacktestReports(
  userId: string,
  query: string,
  limit: number,
): Promise<ResearchDataCatalogBacktestReportV1[]> {
  const reports = await prisma.backtestReport.findMany({
    where: {
      userId,
      status: 'done',
      payload: { not: Prisma.DbNull },
      ...(query
        ? {
            OR: [
              { id: { contains: query } },
              { strategyId: { contains: query } },
              { strategyName: { contains: query } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      strategyId: true,
      strategyName: true,
      config: true,
      createdAt: true,
      computedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  return reports.map((report) => {
    const config =
      report.config && typeof report.config === 'object' && !Array.isArray(report.config)
        ? (report.config as Record<string, unknown>)
        : {};
    return {
      kind: 'backtest_report',
      id: report.id,
      strategyId: report.strategyId,
      strategyName: report.strategyName,
      start: typeof config.start === 'string' ? config.start : '',
      end: typeof config.end === 'string' ? config.end : '',
      language: config.language === 'python' ? 'python' : 'typescript',
      createdAt: report.createdAt.toISOString(),
      computedAt: report.computedAt?.toISOString() ?? null,
    };
  });
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
