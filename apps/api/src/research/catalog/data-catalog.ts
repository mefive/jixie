import { isRetiredFactorReport } from '#factor/evaluations/report-spec.js';
import { factorReportStatusWhere } from '#factor/evaluations/state.js';
import { strategyScanReportStatusWhere } from '#strategy/scans/state.js';
import { backtestReportStatusWhere } from '#strategy/backtests/state.js';
import {
  RESEARCH_EQUITY_UNIVERSE_SUGGESTIONS_V1,
  RESEARCH_FX_SERIES_IDS_V1,
  RESEARCH_MACRO_SERIES_KEYS_V1,
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
  type ResearchDataCatalogStrategyScanReportV1,
  type ResearchFxSeriesIdV1,
  type ResearchMacroSeriesKeyV1,
  type ResearchMeasureDefinitionV1,
} from '@jixie/shared';
import { Prisma } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import {
  etfResearchMembership,
  type EtfResearchMembership,
} from '#market/registry/etf-research-registry.js';
import { researchCapabilityCatalog } from './capabilities.js';

/**
 * 限定研究目录的关键词、范围和资产筛选。
 *
 * Configure research catalog terms, scope and asset filters.
 */
export interface ResearchDataCatalogQuery {
  query?: string;
  assetType?: ResearchAssetTypeV1;
  scope?: ResearchDataCatalogScopeV1;
  userId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 24;
const DEFAULT_DATASET_LIMIT = 100;

/**
 * 搜索平台治理的研究对象，只返回所请求资产类型可用的指标。
 *
 * Search platform-governed instruments and return the measures valid for the requested asset type.
 */
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
    : (['stock', 'etf', 'index'] as const);
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
      returnColumnDetails:
        method.returns.kind === 'dataframe'
          ? method.returns.columns.map((column) => ({
              name: column.name,
              descriptionZh: column.descriptionZh,
              descriptionEn: column.descriptionEn,
            }))
          : [],
    }));

  if (scope === 'factor_reports') {
    const factorReports = input.userId ? await searchFactorReports(input.userId, query, limit) : [];

    return {
      version: 1,
      query,
      sdkMethods,
      instruments: [],
      datasets: [],
      factorReports,
      backtestReports: [],
      strategyScanReports: [],
      measures: [],
    };
  }

  if (scope === 'backtest_reports') {
    const [backtestReports, strategyScanReports] = input.userId
      ? await Promise.all([
          searchBacktestReports(input.userId, query, limit),
          searchStrategyScanReports(input.userId, query, limit),
        ])
      : [[], []];
    return {
      version: 1,
      query,
      sdkMethods,
      instruments: [],
      datasets: [],
      factorReports: [],
      backtestReports,
      strategyScanReports,
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
      strategyScanReports: [],
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
      strategyScanReports: [],
      measures,
    };
  }

  const [stocks, etfs, indexes, marketBenchmarks, indexCodes] = await Promise.all([
    assetTypes.includes('stock')
      ? getDatabase().stockBasic.findMany({
          where: {
            OR: [
              { tsCode: { contains: query } },
              { symbol: { contains: query } },
              { name: { contains: query } },
            ],
          },
          select: { tsCode: true, name: true, market: true },
          take: limit,
        })
      : Promise.resolve([]),
    assetTypes.includes('etf')
      ? getDatabase().etfBasic.findMany({
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
      ? getDatabase().indexBenchmark.findMany({
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
      ? getDatabase().marketBenchmark.findMany({
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
      ? getDatabase().indexDaily.findMany({
          where: { tsCode: { contains: query } },
          select: { tsCode: true },
          distinct: ['tsCode'],
          take: limit,
        })
      : Promise.resolve([]),
  ]);

  const knownIndexCodes = new Set(indexes.map((item) => item.tsCode));
  const candidates: ResearchDataCatalogInstrumentV1[] = [
    ...stocks.map((item) =>
      instrument('stock', item.tsCode, item.name, measures, compact([item.market])),
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
    strategyScanReports: [],
    measures,
  };
}

/**
 * 按目录范围列出合法 SDK 方法，供候选过滤。
 *
 * List supported SDK methods for a catalog scope.
 */
function catalogMethodNames(scope: ResearchDataCatalogScopeV1): string[] {
  switch (scope) {
    case 'datasets':
      return [
        'data.cross_section',
        'data.panel',
        'data.yield_curve',
        'data.macro',
        'data.fx',
        'data.equity_fundamentals',
        'data.equity_financial_values',
        'data.equity_financial_statements',
        'data.equity_financial_metrics',
        'data.equity_financial_cross_section',
        'data.equity_financial_panel',
        'data.equity_dividends',
        'data.etf_shares',
        'data.index_valuation',
      ];
    case 'factor_reports':
      return ['results.factor_report'];
    case 'backtest_reports':
      return ['results.backtest_report', 'results.strategy_scan_report'];
    default:
      return ['data.series'];
  }
}

/**
 * 根据语义请求筛选数据集及其参数，供目录选择。
 *
 * Filter governed datasets and parameters for a semantic catalog request.
 */
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
    etfShareCoverageRows,
    etfMetadataRows,
    indexValuationCoverageRows,
    indexMetadataRows,
    financialIncomeCoverage,
    financialBalanceCoverage,
    financialCashFlowCoverage,
  ] = await Promise.all([
    getDatabase().daily.findFirst({ orderBy: { tradeDate: 'asc' }, select: { tradeDate: true } }),
    getDatabase().daily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
    getDatabase().dailyBasic.findFirst({
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true },
    }),
    getDatabase().dailyBasic.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    }),
    getDatabase().indexWeight.groupBy({
      by: ['indexCode'],
      where: { indexCode: { in: indexCodes } },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    getDatabase().yieldCurvePoint.groupBy({
      by: ['curveCode', 'termYears'],
      where: { curveCode: { in: [...RESEARCH_YIELD_CURVE_CODES_V1] } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    getDatabase().macroSeries.findMany({
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
    getDatabase().macroObservation.groupBy({
      by: ['seriesKey'],
      where: { seriesKey: { in: [...RESEARCH_MACRO_SERIES_KEYS_V1] } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    getDatabase().fxDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: ['USDCNH.FXCM', 'USDHKD.FXCM'] } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    getDatabase().etfShareSize.groupBy({
      by: ['tsCode'],
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    getDatabase().etfBasic.findMany({
      select: { tsCode: true, name: true, fundType: true, indexName: true },
    }),
    getDatabase().indexDailyBasic.groupBy({
      by: ['tsCode'],
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    getDatabase().indexBenchmark.findMany({
      select: { tsCode: true, name: true, indexType: true },
    }),
    getDatabase().financialIncomeStatement.aggregate({
      where: { availabilityQuality: { not: 'reconstructed' } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    getDatabase().financialBalanceSheet.aggregate({
      where: { availabilityQuality: { not: 'reconstructed' } },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
    getDatabase().financialCashFlowStatement.aggregate({
      where: { availabilityQuality: { not: 'reconstructed' } },
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

  /**
   * 构造股票截面和 Panel 数据集目录项，保留证券池与 PIT 约束。
   *
   * Build equity cross-section and panel catalog entries with universe and PIT constraints.
   */
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
  const etfMetadata = new Map(etfMetadataRows.map((row) => [row.tsCode, row]));
  const etfShareDatasets: ResearchDataCatalogDatasetV1[] = etfShareCoverageRows.flatMap((row) => {
    const start = row._min.availableDate;
    const end = row._max.availableDate;
    if (!start || !end) {
      return [];
    }
    const meta = etfMetadata.get(row.tsCode);
    return [
      {
        kind: 'dataset',
        id: `data.etf_shares:${row.tsCode}`,
        method: 'data.etf_shares',
        identifier: row.tsCode,
        nameZh: `${meta?.name ?? row.tsCode} ETF 份额`,
        nameEn: `${meta?.name ?? row.tsCode} ETF shares`,
        descriptionZh: '按研究可得日治理的 ETF 份额、规模、净值与收盘价。',
        descriptionEn: 'ETF shares, size, NAV, and close governed by research availability date.',
        tags: compact([row.tsCode, meta?.fundType, meta?.indexName, 'ETF', 'PIT']),
        localDataCoverage: readyDatasetCoverage(start, end, 'availableDate'),
      },
    ];
  });
  const indexMetadata = new Map(indexMetadataRows.map((row) => [row.tsCode, row]));
  const indexValuationDatasets: ResearchDataCatalogDatasetV1[] = indexValuationCoverageRows.flatMap(
    (row) => {
      const start = row._min.tradeDate;
      const end = row._max.tradeDate;
      if (!start || !end) {
        return [];
      }
      const meta = indexMetadata.get(row.tsCode);
      return [
        {
          kind: 'dataset',
          id: `data.index_valuation:${row.tsCode}`,
          method: 'data.index_valuation',
          identifier: row.tsCode,
          nameZh: `${meta?.name ?? row.tsCode}指数估值`,
          nameEn: `${meta?.name ?? row.tsCode} index valuation`,
          descriptionZh: '供应商直接计算的指数市值、换手率与估值指标。',
          descriptionEn: 'Provider-computed index market value, turnover, and valuation measures.',
          tags: compact([row.tsCode, meta?.indexType, 'index', 'valuation']),
          localDataCoverage: readyDatasetCoverage(start, end, 'tradeDate'),
        },
      ];
    },
  );
  const financialCoverage = intersectDatasetCoverage(
    [
      [financialIncomeCoverage._min.availableDate, financialIncomeCoverage._max.availableDate],
      [financialBalanceCoverage._min.availableDate, financialBalanceCoverage._max.availableDate],
      [financialCashFlowCoverage._min.availableDate, financialCashFlowCoverage._max.availableDate],
    ],
    'availableDate',
  );
  const financialSingleStockDatasets: ResearchDataCatalogDatasetV1[] = [
    {
      kind: 'dataset',
      id: 'data.equity_financial_values',
      method: 'data.equity_financial_values',
      identifier: '000858.SZ',
      nameZh: '自选财报科目与计算口径',
      nameEn: 'Selected financial fields and period basis',
      descriptionZh:
        '按同一历史可用日批量读取财报科目，选择年度、单季、TTM或原报表口径。保留缺失原因与输入版本；金融企业来源尚未接入。',
      descriptionEn:
        'Batch financial fields at one availability cutoff, with annual, quarterly, TTM, or reported values. Preserves missing reasons and input versions; financial-sector sources are not integrated.',
      tags: ['财报', 'fundamentals', 'PIT', 'quarterly', 'annual', 'TTM', 'fields'],
      localDataCoverage: financialCoverage,
    },
    {
      kind: 'dataset',
      id: 'data.equity_financial_statements',
      method: 'data.equity_financial_statements',
      identifier: '000858.SZ',
      nameZh: '单股版本化三张财报',
      nameEn: 'Single-equity versioned statements',
      descriptionZh: '按历史估值日读取严格 PIT 的利润表、资产负债表和现金流量表长表。',
      descriptionEn:
        'Strict-PIT income, balance-sheet, and cash-flow long table on a historical as-of date.',
      tags: ['财报', 'fundamentals', 'PIT', 'versioned', 'industrial'],
      localDataCoverage: financialCoverage,
    },
    {
      kind: 'dataset',
      id: 'data.equity_financial_metrics',
      method: 'data.equity_financial_metrics',
      identifier: '000858.SZ',
      nameZh: '单股标准化财务指标',
      nameEn: 'Single-equity standardized financial metrics',
      descriptionZh: '按历史估值日计算带单位、公式版本、输入版本和失败原因的预定义指标。',
      descriptionEn:
        'Predefined metrics with units, formula version, input versions, and failure reasons on a historical as-of date.',
      tags: ['财务指标', 'ROIC', 'FCFF', 'PIT', 'industrial'],
      localDataCoverage: financialCoverage,
    },
  ];

  /**
   * 构造财务证券池数据集目录，保留指标、字段与报告期选项。
   *
   * Build financial universe catalog entries with metric, field and reporting-period options.
   */
  const financialUniverseDatasets: ResearchDataCatalogDatasetV1[] =
    RESEARCH_EQUITY_UNIVERSE_SUGGESTIONS_V1.flatMap((universe) => {
      const meta = equityUniverseMeta(universe);
      const indexCoverage = universe.startsWith('index:')
        ? weightCoverage.get(universe.slice('index:'.length))
        : undefined;
      const marketCoverage = indexCoverage
        ? intersectDatasetCoverage([
            equityCoverage.status === 'ready'
              ? [equityCoverage.startDate, equityCoverage.endDate]
              : [undefined, undefined],
            indexCoverage,
          ])
        : equityCoverage;
      const coverage = intersectDatasetCoverage([
        financialCoverage.status === 'ready'
          ? [financialCoverage.startDate, financialCoverage.endDate]
          : [undefined, undefined],
        marketCoverage.status === 'ready'
          ? [marketCoverage.startDate, marketCoverage.endDate]
          : [undefined, undefined],
      ]);
      return [
        {
          kind: 'dataset' as const,
          id: `data.equity_financial_cross_section:${universe}`,
          method: 'data.equity_financial_cross_section' as const,
          universe,
          nameZh: `${meta.nameZh}财务指标截面`,
          nameEn: `${meta.nameEn} financial cross-section`,
          descriptionZh: '按一个历史截面日批量计算最新可用财务指标，最多八个指标。',
          descriptionEn:
            'Batch-calculate up to eight latest-available financial metrics on one historical date.',
          tags: [...meta.tags, '财务指标', 'PIT', 'cross-section'],
          localDataCoverage: coverage,
        },
        {
          kind: 'dataset' as const,
          id: `data.equity_financial_panel:${universe}`,
          method: 'data.equity_financial_panel' as const,
          universe,
          nameZh: `${meta.nameZh}财务指标月末面板`,
          nameEn: `${meta.nameEn} financial month-end panel`,
          descriptionZh: '逐月末批量计算当时股票池的最新可用财务指标，最多八个指标。',
          descriptionEn:
            'Batch-calculate up to eight latest-available metrics for each point-in-time month-end universe.',
          tags: [...meta.tags, '财务指标', 'PIT', 'panel', 'month-end'],
          localDataCoverage: coverage,
        },
      ];
    });
  const datasets = [
    ...equityDatasets,
    ...financialSingleStockDatasets,
    ...financialUniverseDatasets,
    ...macroDatasets,
    ...fxDatasets,
    ...yieldDatasets,
    ...etfShareDatasets,
    ...indexValuationDatasets,
  ];
  const normalizedQuery = query.toLocaleLowerCase();
  return datasets
    .filter((dataset) => !normalizedQuery || datasetSearchText(dataset).includes(normalizedQuery))
    .slice(0, limit);
}

/**
 * 整理股票证券池标识与覆盖，供数据集目录展示。
 *
 * Describe equity-universe identifiers and coverage for the dataset catalog.
 */
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

/**
 * 整理公开利率曲线来源与期限，供精确目录选择。
 *
 * Describe public yield-curve sources and tenors for exact catalog selection.
 */
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

/**
 * 整理已声明外汇序列及报价币种，供目录引用。
 *
 * Describe declared FX series and quote currencies for catalog references.
 */
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

/**
 * 将目录期限转换为年数，供匹配与排序。
 *
 * Convert catalog tenors to years for matching and sorting.
 */
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

/**
 * 从数据集定义提取合法标识选项，供目录参数校验。
 *
 * Extract supported identifiers from dataset definitions for argument validation.
 */
function datasetIdentifiers(dataset: ResearchDataCatalogDatasetV1): string[] {
  switch (dataset.method) {
    case 'data.yield_curve':
      return [dataset.curve, dataset.tenor];
    case 'data.macro':
      return [dataset.series];
    case 'data.fx':
      return [dataset.pair];
    case 'data.etf_shares':
    case 'data.index_valuation':
    case 'data.equity_financial_values':
    case 'data.equity_financial_statements':
    case 'data.equity_financial_metrics':
      return [dataset.identifier];
    default:
      return [dataset.universe];
  }
}

/**
 * 取多个数据集覆盖交集，供共同可运行窗口说明。
 *
 * Intersect dataset coverage to describe common usable bounds.
 */
function intersectDatasetCoverage(
  ranges: ReadonlyArray<readonly [string | null | undefined, string | null | undefined]>,
  dateBasis: 'tradeDate' | 'availableDate' = 'tradeDate',
): ResearchDataCatalogDatasetCoverageV1 {
  if (ranges.some(([start, end]) => !start || !end)) {
    return missingDatasetCoverage();
  }
  const starts = ranges.map(([start]) => start as string);
  const ends = ranges.map(([, end]) => end as string);
  const start = starts.sort().at(-1);
  const end = ends.sort()[0];
  return start && end && start <= end
    ? readyDatasetCoverage(start, end, dateBasis)
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

/**
 * 按用户权限搜索保留回测结果，返回可用于 Research 的稳定引用。
 *
 * Search authorized retained backtest reports and return stable research references.
 */
async function searchBacktestReports(
  userId: string,
  query: string,
  limit: number,
): Promise<ResearchDataCatalogBacktestReportV1[]> {
  const reports = await getDatabase().backtestReport.findMany({
    where: {
      userId,
      AND: [backtestReportStatusWhere(['done'])],
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
      settings: true,
      createdAt: true,
      computedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  return reports.map((report) => {
    const config =
      report.settings && typeof report.settings === 'object' && !Array.isArray(report.settings)
        ? (report.settings as Record<string, unknown>)
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

/**
 * 按用户权限搜索扫描报告，提供可重用的报告身份。
 *
 * Search authorized scan reports for reusable report identities.
 */
async function searchStrategyScanReports(
  userId: string,
  query: string,
  limit: number,
): Promise<ResearchDataCatalogStrategyScanReportV1[]> {
  const reports = await getDatabase().strategyScanReport.findMany({
    where: {
      userId,
      AND: [strategyScanReportStatusWhere(['done'])],
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
      dataCutoff: true,
      spec: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return reports.map((report) => {
    const spec =
      report.spec && typeof report.spec === 'object' && !Array.isArray(report.spec)
        ? (report.spec as Record<string, unknown>)
        : {};
    const dimensions = Array.isArray(spec.dimensions) ? spec.dimensions : [];
    return {
      kind: 'strategy_scan_report',
      id: report.id,
      strategyId: report.strategyId,
      strategyName: report.strategyName,
      dataCutoff: report.dataCutoff,
      parameterNames: dimensions.flatMap((dimension) => {
        if (!dimension || typeof dimension !== 'object' || Array.isArray(dimension)) {
          return [];
        }
        const key = (dimension as Record<string, unknown>).key;
        return typeof key === 'string' ? [key] : [];
      }),
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  });
}

/**
 * 仅搜索当前用户已完成的因子报告。
 *
 * Search completed factor reports owned by the current user.
 */
async function searchFactorReports(
  userId: string,
  query: string,
  limit: number,
): Promise<ResearchDataCatalogFactorReportV1[]> {
  const factors = await getDatabase().factor.findMany({
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
  const reports: ResearchDataCatalogFactorReportV1[] = [];
  let cursor: string | undefined;

  while (reports.length < limit) {
    const batch = await getDatabase().factorReport.findMany({
      where: {
        userId,
        AND: [factorReportStatusWhere(['done'])],
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
        specJson: true,
        neutral: true,
        factorCodeSnapshot: true,
        createdAt: true,
        computedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    reports.push(
      ...batch
        .filter((report) => !isRetiredFactorReport(report))
        .map<ResearchDataCatalogFactorReportV1>((report) => {
          return {
            kind: 'factor_report',
            id: report.id,
            factor: report.factor,
            factorName: factorNames.get(report.factor) ?? report.factor,
            analysisKind: factorAnalysisKind(report.analysisKind),
            createdAt: report.createdAt.toISOString(),
            computedAt: report.computedAt?.toISOString() ?? null,
          };
        }),
    );

    if (batch.length < limit) {
      break;
    }
    cursor = batch.at(-1)!.id;
  }

  return reports.slice(0, limit);
}

/**
 * 规范化目录因子报告的分析种类，供匹配和展示。
 *
 * Normalize factor report analysis kinds for catalog matching and rendering.
 */
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

/**
 * 为目录候选附加本地数据起止范围与记录覆盖。
 *
 * Attach local data bounds and coverage to catalog candidates.
 */
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
  const [stocks, etfs, indexes, benchmarks] = await Promise.all([
    getDatabase().daily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: stockCodes } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    getDatabase().etfDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: etfCodes } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    getDatabase().indexDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: indexCodes } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    getDatabase().marketBenchmarkDaily.groupBy({
      by: ['benchmarkId'],
      where: { benchmarkId: { in: benchmarkIds } },
      _count: { _all: true },
      _min: { availableDate: true },
      _max: { availableDate: true },
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

/**
 * 将已验证证券映射为带合法 measure 的目录项。
 *
 * Map a verified instrument into a catalog entry with supported measures.
 */
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

/**
 * 根据精确身份、名称和语义匹配为目录候选评分。
 *
 * Score catalog candidates using identity, name and semantic matches.
 */
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
