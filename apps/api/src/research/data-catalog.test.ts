import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stockFindMany: vi.fn(),
  etfFindMany: vi.fn(),
  indexFindMany: vi.fn(),
  marketBenchmarkFindMany: vi.fn(),
  indexDailyFindMany: vi.fn(),
  futureMappingFindMany: vi.fn(),
  futureFindMany: vi.fn(),
  dailyFindFirst: vi.fn(),
  dailyGroupBy: vi.fn(),
  dailyBasicFindFirst: vi.fn(),
  indexWeightGroupBy: vi.fn(),
  yieldCurveGroupBy: vi.fn(),
  macroSeriesFindMany: vi.fn(),
  macroObservationGroupBy: vi.fn(),
  fxDailyGroupBy: vi.fn(),
  commodityContinuousReturnGroupBy: vi.fn(),
  commodityWarehouseReceiptGroupBy: vi.fn(),
  commodityHoldingPositionGroupBy: vi.fn(),
  marketIndicatorAggregate: vi.fn(),
  indexIndicatorGroupBy: vi.fn(),
  etfDailyGroupBy: vi.fn(),
  indexDailyGroupBy: vi.fn(),
  marketBenchmarkDailyGroupBy: vi.fn(),
  futureMappingGroupBy: vi.fn(),
  futureDailyGroupBy: vi.fn(),
  factorFindMany: vi.fn(),
  factorReportFindMany: vi.fn(),
  backtestReportFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    stockBasic: { findMany: mocks.stockFindMany },
    etfBasic: { findMany: mocks.etfFindMany },
    indexBenchmark: { findMany: mocks.indexFindMany },
    marketBenchmark: { findMany: mocks.marketBenchmarkFindMany },
    daily: { findFirst: mocks.dailyFindFirst, groupBy: mocks.dailyGroupBy },
    dailyBasic: { findFirst: mocks.dailyBasicFindFirst },
    indexWeight: { groupBy: mocks.indexWeightGroupBy },
    yieldCurvePoint: { groupBy: mocks.yieldCurveGroupBy },
    macroSeries: { findMany: mocks.macroSeriesFindMany },
    macroObservation: { groupBy: mocks.macroObservationGroupBy },
    fxDaily: { groupBy: mocks.fxDailyGroupBy },
    commodityContinuousReturn: { groupBy: mocks.commodityContinuousReturnGroupBy },
    commodityWarehouseReceipt: { groupBy: mocks.commodityWarehouseReceiptGroupBy },
    commodityHoldingPosition: { groupBy: mocks.commodityHoldingPositionGroupBy },
    marketIndicator: { aggregate: mocks.marketIndicatorAggregate },
    indexIndicator: { groupBy: mocks.indexIndicatorGroupBy },
    etfDaily: { groupBy: mocks.etfDailyGroupBy },
    indexDaily: { findMany: mocks.indexDailyFindMany, groupBy: mocks.indexDailyGroupBy },
    marketBenchmarkDaily: { groupBy: mocks.marketBenchmarkDailyGroupBy },
    futureMapping: {
      findMany: mocks.futureMappingFindMany,
      groupBy: mocks.futureMappingGroupBy,
    },
    futureContract: { findMany: mocks.futureFindMany },
    futureDaily: { groupBy: mocks.futureDailyGroupBy },
    factor: { findMany: mocks.factorFindMany },
    factorReport: { findMany: mocks.factorReportFindMany },
    backtestReport: { findMany: mocks.backtestReportFindMany },
  },
}));

import { searchResearchDataCatalog } from './data-catalog.js';

describe('research data catalog', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue([]));
    mocks.marketIndicatorAggregate.mockResolvedValue({
      _min: { tradeDate: null },
      _max: { tradeDate: null },
    });
  });

  it('returns only series-compatible measures before a user enters a query', async () => {
    const result = await searchResearchDataCatalog({ assetType: 'index' });

    expect(result.instruments).toEqual([]);
    expect(result.factorReports).toEqual([]);
    expect(result.backtestReports).toEqual([]);
    expect(result.measures.map((measure) => measure.id)).toEqual([
      'market.adjusted_close',
      'market.cny_close',
    ]);
    expect(result.sdkMethods.map((method) => method.qualifiedName)).toEqual(['data.series']);
    expect(mocks.indexFindMany).not.toHaveBeenCalled();
    expect(mocks.indexDailyGroupBy).not.toHaveBeenCalled();
  });

  it('discovers locally available governed datasets without scanning observation counts', async () => {
    mocks.dailyFindFirst
      .mockResolvedValueOnce({ tradeDate: '20150105' })
      .mockResolvedValueOnce({ tradeDate: '20260730' });
    mocks.dailyBasicFindFirst
      .mockResolvedValueOnce({ tradeDate: '20150105' })
      .mockResolvedValueOnce({ tradeDate: '20260730' });
    mocks.indexWeightGroupBy.mockResolvedValue([
      {
        indexCode: '000300.SH',
        _min: { tradeDate: '20150130' },
        _max: { tradeDate: '20260701' },
      },
    ]);
    mocks.yieldCurveGroupBy.mockResolvedValue([
      {
        curveCode: 'us_treasury_nominal',
        termYears: 10,
        _min: { availableDate: '20050103' },
        _max: { availableDate: '20260804' },
      },
      {
        curveCode: 'us_treasury_real',
        termYears: 5,
        _min: { availableDate: '20050103' },
        _max: { availableDate: '20260804' },
      },
    ]);

    const result = await searchResearchDataCatalog({ query: '10Y', scope: 'datasets' });

    expect(result.sdkMethods.map((method) => method.qualifiedName)).toEqual([
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
    ]);
    expect(result.instruments).toEqual([]);
    expect(result.datasets).toEqual([
      expect.objectContaining({
        id: 'data.yield_curve:us_treasury_nominal:10Y',
        method: 'data.yield_curve',
        curve: 'us_treasury_nominal',
        tenor: '10Y',
        localDataCoverage: {
          status: 'ready',
          startDate: '20050103',
          endDate: '20260804',
          dateBasis: 'availableDate',
        },
      }),
    ]);
    expect(mocks.dailyGroupBy).not.toHaveBeenCalled();
  });

  it('discovers governed macro and FX datasets with availability-date coverage', async () => {
    mocks.macroSeriesFindMany.mockResolvedValue([
      {
        seriesKey: 'cn_cpi_yoy',
        nameZh: '中国 CPI 同比',
        nameEn: 'China CPI YoY',
        domain: 'inflation',
        frequency: 'monthly',
        unit: '%',
      },
    ]);
    mocks.macroObservationGroupBy.mockResolvedValue([
      {
        seriesKey: 'cn_cpi_yoy',
        _min: { availableDate: '20100112' },
        _max: { availableDate: '20260810' },
      },
    ]);
    mocks.fxDailyGroupBy.mockResolvedValue([
      {
        tsCode: 'USDCNH.FXCM',
        _min: { availableDate: '20120221' },
        _max: { availableDate: '20260805' },
      },
      {
        tsCode: 'USDHKD.FXCM',
        _min: { availableDate: '20120105' },
        _max: { availableDate: '20260805' },
      },
    ]);

    const macro = await searchResearchDataCatalog({ query: 'CPI', scope: 'datasets' });
    const fx = await searchResearchDataCatalog({ query: 'HKD/CNH', scope: 'datasets' });

    expect(macro.datasets).toEqual([
      expect.objectContaining({ method: 'data.macro', series: 'cn_cpi_yoy' }),
    ]);
    expect(fx.datasets).toEqual([
      expect.objectContaining({
        method: 'data.fx',
        pair: 'HKDCNH.DERIVED',
        localDataCoverage: expect.objectContaining({ status: 'ready' }),
      }),
    ]);
  });

  it('discovers audited commodity datasets by product and available date', async () => {
    const range = {
      _min: { availableDate: '20150106' },
      _max: { availableDate: '20260803' },
    };
    mocks.commodityContinuousReturnGroupBy.mockResolvedValue([{ productCode: 'AU', ...range }]);
    mocks.commodityWarehouseReceiptGroupBy.mockResolvedValue([{ productCode: 'AU', ...range }]);
    mocks.commodityHoldingPositionGroupBy.mockResolvedValue([{ productCode: 'AU', ...range }]);

    const result = await searchResearchDataCatalog({ query: '黄金', scope: 'datasets' });

    expect(result.datasets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'data.commodity_returns', product: 'AU' }),
        expect.objectContaining({ method: 'data.commodity_warehouse_receipts', product: 'AU' }),
        expect.objectContaining({ method: 'data.commodity_holdings', product: 'AU' }),
      ]),
    );
  });

  it('discovers whole-market and PIT index market-state datasets', async () => {
    mocks.marketIndicatorAggregate.mockResolvedValue({
      _min: { tradeDate: '20150105' },
      _max: { tradeDate: '20260731' },
    });
    mocks.indexIndicatorGroupBy.mockResolvedValue([
      {
        indexCode: '000300.SH',
        _min: { tradeDate: '20150130' },
        _max: { tradeDate: '20260731' },
      },
    ]);

    const result = await searchResearchDataCatalog({ query: '沪深 300', scope: 'datasets' });

    expect(result.datasets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'data.market_state',
          scope: '000300.SH',
          localDataCoverage: expect.objectContaining({ status: 'ready' }),
        }),
      ]),
    );
  });

  it('ranks exact stable identifiers and exposes measure compatibility', async () => {
    mocks.indexFindMany.mockResolvedValue([
      {
        tsCode: '000905.SH',
        name: '中证500',
        fullName: '中证小盘500指数',
        indexType: '规模指数',
      },
      {
        tsCode: '000300.SH',
        name: '沪深300',
        fullName: '沪深300指数',
        indexType: '规模指数',
      },
    ]);
    mocks.indexDailyFindMany.mockResolvedValue([{ tsCode: '000300.SH' }]);
    mocks.indexDailyGroupBy.mockResolvedValue([
      {
        tsCode: '000300.SH',
        _count: { _all: 1234 },
        _min: { tradeDate: '20200102' },
        _max: { tradeDate: '20251231' },
      },
    ]);

    const result = await searchResearchDataCatalog({
      query: '000300.SH',
      assetType: 'index',
    });

    expect(result.instruments).toHaveLength(2);
    expect(result.instruments[0]).toMatchObject({
      assetType: 'index',
      identifier: '000300.SH',
      nameZh: '沪深300',
      compatibleMeasureIds: ['market.adjusted_close'],
      localDataCoverage: {
        status: 'ready',
        observationCount: 1234,
        startDate: '20200102',
        endDate: '20251231',
      },
      sdkAccess: { status: 'ready', method: 'data.series' },
    });
  });

  it('marks continuous futures as a stable logical series', async () => {
    mocks.futureMappingFindMany.mockResolvedValue([{ continuousCode: 'AU.SHF' }]);

    const result = await searchResearchDataCatalog({
      query: 'AU',
      assetType: 'future',
    });

    expect(result.instruments[0]).toMatchObject({
      identifier: 'AU.SHF',
      assetType: 'future',
      continuous: true,
      localDataCoverage: { status: 'missing' },
      sdkAccess: { status: 'not_ready' },
    });
  });

  it('reports ETF registry membership separately from local executable coverage', async () => {
    mocks.etfFindMany.mockResolvedValue([
      {
        tsCode: '510300.SH',
        name: '华泰柏瑞沪深300ETF',
        fundType: '股票型',
        indexName: '沪深300',
        exchange: 'SSE',
      },
    ]);
    mocks.etfDailyGroupBy.mockResolvedValue([
      {
        tsCode: '510300.SH',
        _count: { _all: 2500 },
        _min: { tradeDate: '20120528' },
        _max: { tradeDate: '20260824' },
      },
    ]);

    const result = await searchResearchDataCatalog({ query: '510300.SH', assetType: 'etf' });

    expect(result.instruments[0]).toMatchObject({
      researchRegistry: {
        role: 'primary',
        selectionAsOf: '20260824',
      },
      localDataCoverage: {
        status: 'ready',
        observationCount: 2500,
      },
      sdkAccess: { status: 'ready' },
    });
  });

  it('ranks an exact display-name match ahead of longer fund names', async () => {
    mocks.etfFindMany.mockResolvedValue([
      {
        tsCode: '510300.SH',
        name: '华泰柏瑞沪深300ETF',
        fundType: '股票型',
        indexName: '沪深300',
        exchange: 'SSE',
      },
    ]);
    mocks.indexFindMany.mockResolvedValue([
      {
        tsCode: '000300.SH',
        name: '沪深300',
        fullName: '沪深300指数',
        indexType: '规模指数',
      },
    ]);

    const result = await searchResearchDataCatalog({ query: '沪深300' });

    expect(result.instruments.map((item) => item.identifier)).toEqual(['000300.SH', '510300.SH']);
  });

  it('searches completed user FactorReports by factor name and keeps holdout reports sealed', async () => {
    mocks.factorFindMany.mockResolvedValue([
      { key: 'value_quality', name: '价值质量' },
      { key: 'momentum', name: '动量' },
    ]);
    mocks.factorReportFindMany.mockResolvedValue([
      {
        id: 'report-explore',
        factor: 'value_quality',
        analysisKind: 'cross_sectional',
        phase: 'explore',
        revealedAt: null,
        createdAt: new Date('2026-08-20T08:00:00.000Z'),
        computedAt: new Date('2026-08-20T08:01:00.000Z'),
      },
      {
        id: 'report-holdout',
        factor: 'value_quality',
        analysisKind: 'panel',
        phase: 'holdout',
        revealedAt: null,
        createdAt: new Date('2026-08-19T08:00:00.000Z'),
        computedAt: null,
      },
    ]);

    const result = await searchResearchDataCatalog({
      query: '价值',
      scope: 'factor_reports',
      userId: 'user-a',
    });

    expect(mocks.factorReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-a',
          status: 'done',
          OR: expect.arrayContaining([{ factor: { in: ['value_quality'] } }]),
        }),
      }),
    );
    expect(result.sdkMethods.map((method) => method.qualifiedName)).toEqual([
      'results.factor_report',
    ]);
    expect(result.instruments).toEqual([]);
    expect(result.measures).toEqual([]);
    expect(result.factorReports).toEqual([
      expect.objectContaining({
        id: 'report-explore',
        factorName: '价值质量',
        phase: 'explore',
        sealed: false,
      }),
      expect.objectContaining({
        id: 'report-holdout',
        factorName: '价值质量',
        analysisKind: 'panel',
        sealed: true,
      }),
    ]);
    expect(mocks.stockFindMany).not.toHaveBeenCalled();
    expect(mocks.indexFindMany).not.toHaveBeenCalled();
  });

  it('searches completed user BacktestReports and maps their frozen config', async () => {
    mocks.backtestReportFindMany.mockResolvedValue([
      {
        id: 'backtest-report-a',
        strategyId: 'strategy-a',
        strategyName: '价值轮动',
        config: {
          start: '20200101',
          end: '20251231',
          language: 'python',
        },
        createdAt: new Date('2026-08-21T08:00:00.000Z'),
        computedAt: new Date('2026-08-21T08:05:00.000Z'),
      },
    ]);

    const result = await searchResearchDataCatalog({
      query: '价值',
      scope: 'backtest_reports',
      userId: 'user-a',
    });

    expect(mocks.backtestReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-a',
          status: 'done',
          OR: expect.arrayContaining([{ strategyName: { contains: '价值' } }]),
        }),
      }),
    );
    expect(result.sdkMethods.map((method) => method.qualifiedName)).toEqual([
      'results.backtest_report',
    ]);
    expect(result.factorReports).toEqual([]);
    expect(result.backtestReports).toEqual([
      expect.objectContaining({
        id: 'backtest-report-a',
        strategyName: '价值轮动',
        start: '20200101',
        end: '20251231',
        language: 'python',
      }),
    ]);
    expect(mocks.stockFindMany).not.toHaveBeenCalled();
  });
});
