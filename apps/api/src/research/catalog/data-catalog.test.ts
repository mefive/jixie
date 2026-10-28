import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stockFindMany: vi.fn(),
  etfFindMany: vi.fn(),
  indexFindMany: vi.fn(),
  marketBenchmarkFindMany: vi.fn(),
  indexDailyFindMany: vi.fn(),
  dailyFindFirst: vi.fn(),
  dailyGroupBy: vi.fn(),
  dailyBasicFindFirst: vi.fn(),
  indexWeightGroupBy: vi.fn(),
  yieldCurveGroupBy: vi.fn(),
  macroSeriesFindMany: vi.fn(),
  macroObservationGroupBy: vi.fn(),
  fxDailyGroupBy: vi.fn(),
  etfShareSizeGroupBy: vi.fn(),
  indexDailyBasicGroupBy: vi.fn(),
  etfDailyGroupBy: vi.fn(),
  indexDailyGroupBy: vi.fn(),
  marketBenchmarkDailyGroupBy: vi.fn(),
  financialIncomeAggregate: vi.fn(),
  financialBalanceAggregate: vi.fn(),
  financialCashFlowAggregate: vi.fn(),
  factorFindMany: vi.fn(),
  factorReportFindMany: vi.fn(),
  backtestReportFindMany: vi.fn(),
  strategyScanReportFindMany: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
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
      etfShareSize: { groupBy: mocks.etfShareSizeGroupBy },
      indexDailyBasic: { groupBy: mocks.indexDailyBasicGroupBy },
      etfDaily: { groupBy: mocks.etfDailyGroupBy },
      indexDaily: { findMany: mocks.indexDailyFindMany, groupBy: mocks.indexDailyGroupBy },
      marketBenchmarkDaily: { groupBy: mocks.marketBenchmarkDailyGroupBy },
      financialIncomeStatement: { aggregate: mocks.financialIncomeAggregate },
      financialBalanceSheet: { aggregate: mocks.financialBalanceAggregate },
      financialCashFlowStatement: { aggregate: mocks.financialCashFlowAggregate },
      factor: { findMany: mocks.factorFindMany },
      factorReport: { findMany: mocks.factorReportFindMany },
      backtestReport: { findMany: mocks.backtestReportFindMany },
      strategyScanReport: { findMany: mocks.strategyScanReportFindMany },
    },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

import { searchResearchDataCatalog } from './data-catalog.js';

describe('research data catalog', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue([]));
    for (const aggregate of [
      mocks.financialIncomeAggregate,
      mocks.financialBalanceAggregate,
      mocks.financialCashFlowAggregate,
    ]) {
      aggregate.mockResolvedValue({
        _min: { availableDate: null },
        _max: { availableDate: null },
      });
    }
  });

  it('continues past retired reports so they do not hide an available independent factor', async () => {
    const report = {
      factor: 'independent',
      analysisKind: 'cross_sectional',
      createdAt: new Date('2026-01-01'),
      computedAt: null,
      factorCodeSnapshot: null,
    };
    mocks.factorReportFindMany
      .mockResolvedValueOnce([
        { ...report, id: 'retired', specJson: JSON.stringify({ version: 4, composite: {} }) },
      ])
      .mockResolvedValueOnce([{ ...report, id: 'independent', specJson: null }]);

    const result = await searchResearchDataCatalog({
      userId: 'owner',
      scope: 'factor_reports',
      limit: 1,
    });

    expect(result.factorReports.map((item) => item.id)).toEqual(['independent']);
    expect(mocks.factorReportFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { id: 'retired' }, skip: 1 }),
    );
  });

  it('returns only series-compatible measures before a user enters a query', async () => {
    const result = await searchResearchDataCatalog({ assetType: 'index' });

    expect(result.instruments).toEqual([]);
    expect(result.factorReports).toEqual([]);
    expect(result.backtestReports).toEqual([]);
    expect(result.measures.map((measure) => measure.id)).toEqual(['market.adjusted_close']);
    expect(result.sdkMethods.map((method) => method.qualifiedName)).toEqual(['data.series']);
    expect(mocks.indexFindMany).not.toHaveBeenCalled();
    expect(mocks.indexDailyGroupBy).not.toHaveBeenCalled();
  });

  it('discovers locally available governed datasets without scanning observation counts', async () => {
    const result = await searchResearchDataCatalog({ query: '10Y', scope: 'datasets' });
    expect(result.datasets).toEqual([]);
    expect(result.sdkMethods.map((method) => method.qualifiedName)).toContain(
      'data.index_valuation',
    );
    for (const name of ['data.yield_curve', 'data.macro', 'data.fx']) {
      expect(result.sdkMethods.some((method) => method.qualifiedName === name)).toBe(false);
    }
    expect(mocks.dailyGroupBy).not.toHaveBeenCalled();
  });

  it('discovers PIT financial datasets and exposes documented return columns', async () => {
    const coverage = {
      _min: { availableDate: '20230428' },
      _max: { availableDate: '20250430' },
    };
    mocks.financialIncomeAggregate.mockResolvedValue(coverage);
    mocks.financialBalanceAggregate.mockResolvedValue(coverage);
    mocks.financialCashFlowAggregate.mockResolvedValue(coverage);

    const result = await searchResearchDataCatalog({ query: '财务指标', scope: 'datasets' });

    expect(result.datasets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'data.equity_financial_metrics',
          localDataCoverage: {
            status: 'ready',
            startDate: '20230428',
            endDate: '20250430',
            dateBasis: 'availableDate',
          },
        }),
      ]),
    );
    const method = result.sdkMethods.find(
      (candidate) => candidate.qualifiedName === 'data.equity_financial_metrics',
    );
    expect(method?.returnColumns).toContain('formula_version');
    expect(method?.returnColumnDetails).toContainEqual(
      expect.objectContaining({ name: 'missing_reason' }),
    );
    expect(mocks.financialIncomeAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { availabilityQuality: { not: 'reconstructed' } },
      }),
    );
  });

  it('does not query retired macro, curve or FX stores', async () => {
    for (const query of ['CPI', 'HKD/CNH', 'us_treasury_nominal']) {
      const result = await searchResearchDataCatalog({ query, scope: 'datasets' });
      expect(result.datasets).toEqual([]);
    }
    expect(mocks.macroSeriesFindMany).not.toHaveBeenCalled();
    expect(mocks.fxDailyGroupBy).not.toHaveBeenCalled();
    expect(mocks.yieldCurveGroupBy).not.toHaveBeenCalled();
  });

  it('discovers retained index valuation datasets and omits retired ETF shares', async () => {
    mocks.etfFindMany.mockResolvedValue([
      { tsCode: '510300.SH', name: '沪深300ETF', fundType: '股票型', indexName: '沪深300' },
    ]);
    mocks.etfShareSizeGroupBy.mockResolvedValue([
      {
        tsCode: '510300.SH',
        _min: { availableDate: '20150106' },
        _max: { availableDate: '20260803' },
      },
    ]);
    mocks.indexDailyBasicGroupBy.mockResolvedValue([
      {
        tsCode: '000300.SH',
        _min: { tradeDate: '20150105' },
        _max: { tradeDate: '20260731' },
      },
    ]);

    const cases = [['000300.SH', 'data.index_valuation', '000300.SH', 'tradeDate']] as const;
    for (const [query, method, identifier, dateBasis] of cases) {
      const result = await searchResearchDataCatalog({ query, scope: 'datasets' });
      expect(result.datasets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method,
            identifier,
            localDataCoverage: expect.objectContaining({ status: 'ready', dateBasis }),
          }),
        ]),
      );
    }
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

  it('searches completed owned FactorReports by factor name', async () => {
    mocks.factorFindMany.mockResolvedValue([
      { key: 'value_quality', name: '价值质量' },
      { key: 'momentum', name: '动量' },
    ]);
    mocks.factorReportFindMany.mockResolvedValue([
      {
        id: 'report-explore',
        factor: 'value_quality',
        analysisKind: 'cross_sectional',
        createdAt: new Date('2026-08-20T08:00:00.000Z'),
        computedAt: new Date('2026-08-20T08:01:00.000Z'),
      },
      {
        id: 'report-panel',
        factor: 'value_quality',
        analysisKind: 'panel',
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
          AND: [
            {
              OR: [
                { job: { is: { status: { in: ['done'] } } } },
                { job: { is: null }, legacyStatus: { in: ['done'] } },
              ],
            },
          ],
          OR: expect.arrayContaining([{ factor: { in: ['value_quality'] } }]),
        }),
      }),
    );
    expect(result.sdkMethods.map((method) => method.qualifiedName)).toEqual([
      'results.factor_report',
    ]);
    expect(result).not.toHaveProperty('factorWeather');
    expect(result.instruments).toEqual([]);
    expect(result.measures).toEqual([]);
    expect(result.factorReports).toEqual([
      expect.objectContaining({
        id: 'report-explore',
        factorName: '价值质量',
      }),
      expect.objectContaining({
        id: 'report-panel',
        factorName: '价值质量',
        analysisKind: 'panel',
      }),
    ]);
    expect(mocks.stockFindMany).not.toHaveBeenCalled();
    expect(mocks.indexFindMany).not.toHaveBeenCalled();
  });

  it('searches completed user BacktestReports and maps their actual settings', async () => {
    mocks.backtestReportFindMany.mockResolvedValue([
      {
        id: 'backtest-report-a',
        strategyId: 'strategy-a',
        strategyName: '价值轮动',
        settings: {
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
          AND: [
            {
              OR: [
                { job: { is: { status: { in: ['done'] } } } },
                { job: { is: null }, legacyStatus: { in: ['done'] } },
              ],
            },
          ],
          OR: expect.arrayContaining([{ strategyName: { contains: '价值' } }]),
        }),
      }),
    );
    expect(result.sdkMethods.map((method) => method.qualifiedName)).toEqual([
      'results.backtest_report',
      'results.strategy_scan_report',
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

  it('discovers completed parameter scans', async () => {
    mocks.strategyScanReportFindMany.mockResolvedValue([
      {
        id: 'scan-a',
        strategyId: 'strategy-a',
        strategyName: '轮动',
        dataCutoff: '20260731',
        spec: { dimensions: [{ key: 'window', values: [10, 20] }] },
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T01:00:00Z'),
      },
    ]);

    const strategy = await searchResearchDataCatalog({
      scope: 'backtest_reports',
      userId: 'user-a',
    });

    expect(strategy.strategyScanReports).toEqual([
      expect.objectContaining({ id: 'scan-a', parameterNames: ['window'] }),
    ]);
  });
});
