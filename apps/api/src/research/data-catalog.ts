import {
  RESEARCH_EQUITY_UNIVERSE_SUGGESTIONS_V1,
  RESEARCH_COMMODITY_HOLDING_PRODUCT_CODES_V1,
  RESEARCH_COMMODITY_PRODUCT_CODES_V1,
  RESEARCH_FX_SERIES_IDS_V1,
  RESEARCH_MACRO_SERIES_KEYS_V1,
  RESEARCH_MARKET_STATE_SCOPES_V1,
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
  type ResearchFxSeriesIdV1,
  type ResearchMacroSeriesKeyV1,
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
const DEFAULT_DATASET_LIMIT = 100;

/** Search platform-governed instruments and return the measures valid for the requested asset type. */
export async function searchResearchDataCatalog(
  input: ResearchDataCatalogQuery = {},
): Promise<ResearchDataCatalogResultV1> {
  const query = input.query?.trim() ?? '';
  const scope = input.scope ?? 'instruments';
  const limit = Math.min(
    scope === 'datasets' ? 100 : 50,
    Math.max(1, input.limit ?? (scope === 'datasets' ? DEFAULT_DATASET_LIMIT : DEFAULT_LIMIT)),
  );
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
      return [
        'data.cross_section',
        'data.panel',
        'data.yield_curve',
        'data.macro',
        'data.fx',
        'data.commodity_returns',
        'data.commodity_warehouse_receipts',
        'data.commodity_holdings',
        'data.market_state',
        'data.equity_fundamentals',
        'data.equity_flows',
        'data.equity_dividends',
      ];
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
  const [
    dailyStart,
    dailyEnd,
    dailyBasicStart,
    dailyBasicEnd,
    indexWeights,
    yieldCurves,
    macroSeries,
    macroCoverageRows,
    fxCoverageRows,
    commodityReturnCoverageRows,
    commodityWarehouseReceiptCoverageRows,
    commodityHoldingCoverageRows,
    marketStateCoverage,
    indexStateCoverageRows,
  ] = await Promise.all([
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
    prisma.macroSeries.findMany({
      where: { seriesKey: { in: [...RESEARCH_MACRO_SERIES_KEYS_V1] } },
      select: {
        seriesKey: true,
        nameZh: true,
        nameEn: true,
        domain: true,
        frequency: true,
        unit: true,
      },
    }),
    prisma.macroObservation.groupBy({
      by: ['seriesKey'],
      where: { seriesKey: { in: [...RESEARCH_MACRO_SERIES_KEYS_V1] } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    prisma.fxDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: ['USDCNH.FXCM', 'USDHKD.FXCM'] } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    prisma.commodityContinuousReturn.groupBy({
      by: ['productCode'],
      where: { productCode: { in: [...RESEARCH_COMMODITY_PRODUCT_CODES_V1] } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    prisma.commodityWarehouseReceipt.groupBy({
      by: ['productCode'],
      where: { productCode: { in: [...RESEARCH_COMMODITY_PRODUCT_CODES_V1] } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    prisma.commodityHoldingPosition.groupBy({
      by: ['productCode'],
      where: { productCode: { in: [...RESEARCH_COMMODITY_HOLDING_PRODUCT_CODES_V1] } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    prisma.marketIndicator.aggregate({
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    prisma.indexIndicator.groupBy({
      by: ['indexCode'],
      where: {
        indexCode: {
          in: RESEARCH_MARKET_STATE_SCOPES_V1.filter((scope) => scope !== 'all'),
        },
      },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
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
      const meta = yieldCurveMeta(curve);
      return [
        {
          kind: 'dataset' as const,
          id: `data.yield_curve:${curve}:${tenor}`,
          method: 'data.yield_curve' as const,
          curve,
          tenor,
          nameZh: `${meta.nameZh} ${tenor}`,
          nameEn: `${meta.nameEn} ${tenor}`,
          descriptionZh: `按可得日期治理的${meta.nameZh}。`,
          descriptionEn: `Availability-date governed ${meta.nameEn}.`,
          tags: [...meta.tags, tenor, 'yield'],
          localDataCoverage: readyDatasetCoverage(range[0], range[1], 'availableDate'),
        },
      ];
    }),
  );
  const macroCoverage = new Map(
    macroCoverageRows.map((row) => [
      row.seriesKey,
      [row._min.availableDate, row._max.availableDate] as const,
    ]),
  );
  const macroDatasets = macroSeries.flatMap((series) => {
    const range = macroCoverage.get(series.seriesKey);
    if (!range?.[0] || !range[1]) {
      return [];
    }
    return [
      {
        kind: 'dataset' as const,
        id: `data.macro:${series.seriesKey}`,
        method: 'data.macro' as const,
        series: series.seriesKey as ResearchMacroSeriesKeyV1,
        nameZh: series.nameZh,
        nameEn: series.nameEn,
        descriptionZh: `${series.frequency}频率，单位 ${series.unit}；按研究可得日治理。`,
        descriptionEn: `${series.frequency} frequency in ${series.unit}, governed by research availability date.`,
        tags: [series.domain, series.frequency, series.unit, 'PIT'],
        localDataCoverage: readyDatasetCoverage(range[0], range[1], 'availableDate'),
      },
    ];
  });
  const fxCoverage = new Map(
    fxCoverageRows.map((row) => [
      row.tsCode,
      [row._min.availableDate, row._max.availableDate] as const,
    ]),
  );
  const derivedFxCoverage = intersectDatasetCoverage([
    fxCoverage.get('USDCNH.FXCM') ?? [undefined, undefined],
    fxCoverage.get('USDHKD.FXCM') ?? [undefined, undefined],
  ]);
  const fxDatasets = RESEARCH_FX_SERIES_IDS_V1.map((pair) => {
    const meta = fxSeriesMeta(pair);
    const range = fxCoverage.get(pair);
    const localDataCoverage =
      pair === 'HKDCNH.DERIVED'
        ? derivedFxCoverage
        : range?.[0] && range[1]
          ? readyDatasetCoverage(range[0], range[1], 'availableDate')
          : missingDatasetCoverage();
    return {
      kind: 'dataset' as const,
      id: `data.fx:${pair}`,
      method: 'data.fx' as const,
      pair,
      nameZh: meta.nameZh,
      nameEn: meta.nameEn,
      descriptionZh: meta.descriptionZh,
      descriptionEn: meta.descriptionEn,
      tags: [...meta.tags, 'FX', 'PIT'],
      localDataCoverage,
    };
  });
  const commodityReturnCoverage = datasetCoverageByProduct(commodityReturnCoverageRows);
  const commodityWarehouseReceiptCoverage = datasetCoverageByProduct(
    commodityWarehouseReceiptCoverageRows,
  );
  const commodityHoldingCoverage = datasetCoverageByProduct(commodityHoldingCoverageRows);
  const commodityDatasets = RESEARCH_COMMODITY_PRODUCT_CODES_V1.flatMap((product) => {
    const meta = commodityProductMeta(product);
    const shared = {
      kind: 'dataset' as const,
      product,
      nameZh: meta.nameZh,
      nameEn: meta.nameEn,
      tags: [...meta.tags, product, 'PIT'],
    };
    const rows: ResearchDataCatalogDatasetV1[] = [
      {
        ...shared,
        id: `data.commodity_returns:${product}`,
        method: 'data.commodity_returns',
        nameZh: `${meta.nameZh}连续收益`,
        nameEn: `${meta.nameEn} continuous returns`,
        descriptionZh: '审计过的主力合约连续收益、映射合约与换月分解。',
        descriptionEn: 'Audited main-contract continuous returns, mapping, and roll decomposition.',
        localDataCoverage: commodityReturnCoverage.get(product) ?? missingDatasetCoverage(),
      },
      {
        ...shared,
        id: `data.commodity_warehouse_receipts:${product}`,
        method: 'data.commodity_warehouse_receipts',
        nameZh: `${meta.nameZh}仓单`,
        nameEn: `${meta.nameEn} warehouse receipts`,
        descriptionZh: '交易所仓单总量、变化与原始单位。',
        descriptionEn: 'Exchange warehouse-receipt totals, changes, and source units.',
        localDataCoverage:
          commodityWarehouseReceiptCoverage.get(product) ?? missingDatasetCoverage(),
      },
    ];
    if (RESEARCH_COMMODITY_HOLDING_PRODUCT_CODES_V1.includes(product as never)) {
      rows.push({
        ...shared,
        product: product as (typeof RESEARCH_COMMODITY_HOLDING_PRODUCT_CODES_V1)[number],
        id: `data.commodity_holdings:${product}`,
        method: 'data.commodity_holdings',
        nameZh: `${meta.nameZh}会员持仓`,
        nameEn: `${meta.nameEn} member holdings`,
        descriptionZh: '实际代表合约的排名会员多空持仓聚合。',
        descriptionEn:
          'Ranked-member long and short aggregates for the actual representative contract.',
        localDataCoverage: commodityHoldingCoverage.get(product) ?? missingDatasetCoverage(),
      });
    }
    return rows;
  });
  const indexStateCoverage = new Map(
    indexStateCoverageRows.map((row) => [
      row.indexCode,
      [row._min.tradeDate, row._max.tradeDate] as const,
    ]),
  );
  const marketStateDatasets = RESEARCH_MARKET_STATE_SCOPES_V1.map((scope) => {
    const meta = marketStateScopeMeta(scope);
    const range =
      scope === 'all'
        ? [marketStateCoverage._min.tradeDate, marketStateCoverage._max.tradeDate]
        : (indexStateCoverage.get(scope) ?? [null, null]);
    return {
      kind: 'dataset' as const,
      id: `data.market_state:${scope}`,
      method: 'data.market_state' as const,
      scope,
      nameZh: `${meta.nameZh}市场状态`,
      nameEn: `${meta.nameEn} market state`,
      descriptionZh: '活动度、广度、趋势、拥挤度及其可解释底层指标。',
      descriptionEn: 'Activity, breadth, trend, crowding, and their interpretable components.',
      tags: [...meta.tags, 'market state', 'PIT'],
      localDataCoverage:
        range[0] && range[1]
          ? readyDatasetCoverage(range[0], range[1], 'tradeDate')
          : missingDatasetCoverage(),
    };
  });
  const datasets = [
    ...equityDatasets,
    ...macroDatasets,
    ...fxDatasets,
    ...commodityDatasets,
    ...marketStateDatasets,
    ...yieldDatasets,
  ];
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

function yieldCurveMeta(curve: (typeof RESEARCH_YIELD_CURVE_CODES_V1)[number]): {
  nameZh: string;
  nameEn: string;
  tags: string[];
} {
  switch (curve) {
    case 'us_treasury_nominal':
      return {
        nameZh: '美国国债名义收益率',
        nameEn: 'US Treasury nominal yield',
        tags: ['US Treasury', 'nominal'],
      };
    case 'us_treasury_real':
      return {
        nameZh: '美国国债实际收益率',
        nameEn: 'US Treasury real yield',
        tags: ['US Treasury', 'real'],
      };
    case 'mof_cgb_ytm':
      return {
        nameZh: '财政部中国国债收益率',
        nameEn: 'MOF China government bond yield',
        tags: ['中国国债', 'CGB', 'MOF'],
      };
    case 'chinabond_cgb_ytm':
      return {
        nameZh: '中债中国国债收益率',
        nameEn: 'ChinaBond government bond yield',
        tags: ['中国国债', 'CGB', 'ChinaBond'],
      };
    case 'chinabond_bank_aaa_ytm':
      return {
        nameZh: '中债 AAA 银行债收益率',
        nameEn: 'ChinaBond AAA bank bond yield',
        tags: ['银行债', 'AAA', 'ChinaBond'],
      };
    case 'chinabond_cp_note_aaa_ytm':
      return {
        nameZh: '中债 AAA 短融收益率',
        nameEn: 'ChinaBond AAA commercial paper yield',
        tags: ['短融', 'AAA', 'ChinaBond'],
      };
  }
}

function fxSeriesMeta(pair: ResearchFxSeriesIdV1): {
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  tags: string[];
} {
  switch (pair) {
    case 'USDCNH.FXCM':
      return {
        nameZh: '美元/离岸人民币',
        nameEn: 'USD/CNH',
        descriptionZh: 'FXCM 美元兑离岸人民币中间收盘价，按中国市场可得日治理。',
        descriptionEn: 'FXCM USD/CNH mid close governed by China-market availability date.',
        tags: ['USD', 'CNH'],
      };
    case 'USDHKD.FXCM':
      return {
        nameZh: '美元/港币',
        nameEn: 'USD/HKD',
        descriptionZh: 'FXCM 美元兑港币中间收盘价，按中国市场可得日治理。',
        descriptionEn: 'FXCM USD/HKD mid close governed by China-market availability date.',
        tags: ['USD', 'HKD'],
      };
    case 'HKDCNH.DERIVED':
      return {
        nameZh: '港币/离岸人民币（推导）',
        nameEn: 'HKD/CNH (derived)',
        descriptionZh: '由同一可得日的 USDCNH ÷ USDHKD 中间收盘价推导。',
        descriptionEn: 'Derived from same-availability-date USDCNH divided by USDHKD mid closes.',
        tags: ['HKD', 'CNH', 'derived'],
      };
  }
}

function datasetCoverageByProduct(
  rows: Array<{
    productCode: string;
    _min: { availableDate: string | null };
    _max: { availableDate: string | null };
  }>,
): Map<string, ResearchDataCatalogDatasetCoverageV1> {
  return new Map(
    rows.map((row) => [
      row.productCode,
      row._min.availableDate && row._max.availableDate
        ? readyDatasetCoverage(row._min.availableDate, row._max.availableDate, 'availableDate')
        : missingDatasetCoverage(),
    ]),
  );
}

function commodityProductMeta(product: (typeof RESEARCH_COMMODITY_PRODUCT_CODES_V1)[number]): {
  nameZh: string;
  nameEn: string;
  tags: string[];
} {
  switch (product) {
    case 'AU':
      return { nameZh: '黄金', nameEn: 'Gold', tags: ['贵金属', 'precious metal'] };
    case 'CU':
      return { nameZh: '铜', nameEn: 'Copper', tags: ['有色金属', 'base metal'] };
    case 'SC':
      return { nameZh: '原油', nameEn: 'Crude oil', tags: ['能源', 'energy'] };
    case 'M':
      return { nameZh: '豆粕', nameEn: 'Soybean meal', tags: ['农产品', 'agriculture'] };
  }
}

function marketStateScopeMeta(scope: (typeof RESEARCH_MARKET_STATE_SCOPES_V1)[number]): {
  nameZh: string;
  nameEn: string;
  tags: string[];
} {
  switch (scope) {
    case 'all':
      return { nameZh: '全 A 股', nameEn: 'China A-shares', tags: ['全A'] };
    case '000016.SH':
      return { nameZh: '上证 50', nameEn: 'SSE 50', tags: ['SSE 50'] };
    case '000300.SH':
      return { nameZh: '沪深 300', nameEn: 'CSI 300', tags: ['CSI 300'] };
    case '000905.SH':
      return { nameZh: '中证 500', nameEn: 'CSI 500', tags: ['CSI 500'] };
    case '000852.SH':
      return { nameZh: '中证 1000', nameEn: 'CSI 1000', tags: ['CSI 1000'] };
    case '932000.CSI':
      return { nameZh: '中证 2000', nameEn: 'CSI 2000', tags: ['CSI 2000'] };
    case '000510.SH':
      return { nameZh: '中证 A500', nameEn: 'CSI A500', tags: ['CSI A500'] };
    case '399006.SZ':
      return { nameZh: '创业板指', nameEn: 'ChiNext', tags: ['ChiNext'] };
    case '000688.SH':
      return { nameZh: '科创 50', nameEn: 'STAR 50', tags: ['STAR 50'] };
    case '000922.CSI':
      return { nameZh: '中证红利', nameEn: 'CSI Dividend', tags: ['CSI Dividend'] };
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
    ...datasetIdentifiers(dataset),
  ]
    .join('\n')
    .toLocaleLowerCase();
}

function datasetIdentifiers(dataset: ResearchDataCatalogDatasetV1): string[] {
  switch (dataset.method) {
    case 'data.yield_curve':
      return [dataset.curve, dataset.tenor];
    case 'data.macro':
      return [dataset.series];
    case 'data.fx':
      return [dataset.pair];
    case 'data.commodity_returns':
    case 'data.commodity_warehouse_receipts':
    case 'data.commodity_holdings':
      return [dataset.product];
    case 'data.market_state':
      return [dataset.scope];
    default:
      return [dataset.universe];
  }
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
