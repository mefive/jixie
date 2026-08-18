import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stockFindMany: vi.fn(),
  etfFindMany: vi.fn(),
  indexFindMany: vi.fn(),
  marketBenchmarkFindMany: vi.fn(),
  indexDailyFindMany: vi.fn(),
  futureMappingFindMany: vi.fn(),
  futureFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    stockBasic: { findMany: mocks.stockFindMany },
    etfBasic: { findMany: mocks.etfFindMany },
    indexBenchmark: { findMany: mocks.indexFindMany },
    marketBenchmark: { findMany: mocks.marketBenchmarkFindMany },
    indexDaily: { findMany: mocks.indexDailyFindMany },
    futureMapping: { findMany: mocks.futureMappingFindMany },
    futureContract: { findMany: mocks.futureFindMany },
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
    expect(result.measures.map((measure) => measure.id)).toEqual([
      'market.adjusted_close',
      'market.cny_close',
    ]);
    expect(mocks.indexFindMany).not.toHaveBeenCalled();
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
});
