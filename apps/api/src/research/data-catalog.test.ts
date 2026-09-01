import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stockFindMany: vi.fn(),
  etfFindMany: vi.fn(),
  indexFindMany: vi.fn(),
  marketBenchmarkFindMany: vi.fn(),
  indexDailyFindMany: vi.fn(),
  futureMappingFindMany: vi.fn(),
  futureFindMany: vi.fn(),
  dailyGroupBy: vi.fn(),
  etfDailyGroupBy: vi.fn(),
  indexDailyGroupBy: vi.fn(),
  marketBenchmarkDailyGroupBy: vi.fn(),
  futureMappingGroupBy: vi.fn(),
  futureDailyGroupBy: vi.fn(),
  factorFindMany: vi.fn(),
  factorReportFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    stockBasic: { findMany: mocks.stockFindMany },
    etfBasic: { findMany: mocks.etfFindMany },
    indexBenchmark: { findMany: mocks.indexFindMany },
    marketBenchmark: { findMany: mocks.marketBenchmarkFindMany },
    daily: { groupBy: mocks.dailyGroupBy },
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
  },
}));

import { searchResearchDataCatalog } from './data-catalog.js';

describe('research data catalog', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue([]));
  });

  it('returns only series-compatible measures before a user enters a query', async () => {
    const result = await searchResearchDataCatalog({ assetType: 'index' });

    expect(result.instruments).toEqual([]);
    expect(result.factorReports).toEqual([]);
    expect(result.measures.map((measure) => measure.id)).toEqual([
      'market.adjusted_close',
      'market.cny_close',
    ]);
    expect(result.sdkMethods.map((method) => method.qualifiedName)).toEqual([
      'data.series',
      'data.cross_section',
      'data.panel',
      'data.yield_curve',
    ]);
    expect(result.sdkMethods.find((method) => method.qualifiedName === 'data.panel')).toMatchObject(
      {
        signature: expect.stringContaining('data.panel('),
        example: expect.stringContaining('data.panel("index:000300.SH"'),
        returnColumns: expect.arrayContaining(['date', 'code', 'pe_ttm']),
      },
    );
    expect(mocks.indexFindMany).not.toHaveBeenCalled();
    expect(mocks.indexDailyGroupBy).not.toHaveBeenCalled();
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
          payload: { not: null },
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
});
