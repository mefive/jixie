import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const database = vi.hoisted(() => ({
  stockBasic: { findMany: vi.fn() },
  etfBasic: { findMany: vi.fn() },
  futureContract: { findMany: vi.fn() },
  futureMapping: { findMany: vi.fn() },
  futureDaily: { findMany: vi.fn() },
  indexDaily: { findMany: vi.fn() },
  indexDailyBasic: { groupBy: vi.fn(), findMany: vi.fn() },
}));
vi.mock('#infra/database/prisma.js', () => ({ prisma: database }));
import { routes } from './routes.js';

const app = new Hono().route('/api/app/market', routes);
const request = (url: string) => app.request(`/api/app/market${url}`);

beforeEach(() => {
  vi.resetAllMocks();
  for (const table of Object.values(database)) {
    for (const query of Object.values(table)) {
      query.mockResolvedValue([]);
    }
  }
});

describe('market HTTP reads', () => {
  it('resolves names across asset classes and preserves continuous-future labels', async () => {
    database.stockBasic.findMany.mockResolvedValue([{ tsCode: '600519.SH', name: '贵州茅台' }]);
    database.etfBasic.findMany.mockResolvedValue([{ tsCode: '510300.SH', name: '沪深300ETF' }]);
    const response = await request('/names?codes=600519.SH,,510300.SH,IF.CFX,unknown');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      '600519.SH': '贵州茅台',
      '510300.SH': '沪深300ETF',
      'IF.CFX': '沪深300股指期货主力',
    });
    expect(database.stockBasic.findMany).toHaveBeenCalledWith({
      where: { tsCode: { in: ['600519.SH', '510300.SH', 'IF.CFX', 'unknown'] } },
      select: { tsCode: true, name: true },
    });
  });

  it('caps bulk names at 500 nonempty codes', async () => {
    const codes = Array.from({ length: 501 }, (_, index) => `code${index}`);
    const response = await request(`/names?codes=${codes.join(',')}`);
    expect(response.status).toBe(200);
    expect(database.stockBasic.findMany.mock.calls[0][0].where.tsCode.in).toEqual(
      codes.slice(0, 500),
    );
  });

  it.each([
    '/names',
    '/objects/bond/example/series',
    '/objects/stock/600519.SH/series?start=20260101&end=20260101',
    '/objects/stock/600519.SH/series?start=invalid',
    '/weather?dimension=unknown',
    '/industry-weather?frequency=day',
    '/state?scope=unknown',
  ])('rejects invalid input before reading data: %s', async (url) => {
    const response = await request(url);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    for (const table of Object.values(database)) {
      for (const query of Object.values(table)) {
        expect(query).not.toHaveBeenCalled();
      }
    }
  });

  it('keeps the valuation catalog ahead of the code route and filters unsupported coverage', async () => {
    database.indexDailyBasic.groupBy.mockResolvedValue([
      {
        tsCode: '000300.SH',
        _min: { tradeDate: '20200101' },
        _max: { tradeDate: '20260901' },
        _count: { _all: 42 },
      },
      {
        tsCode: 'unknown',
        _min: { tradeDate: '20200101' },
        _max: { tradeDate: '20260901' },
        _count: { _all: 1 },
      },
    ]);
    const response = await request('/indices/valuation/catalog');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      indices: [{ tsCode: '000300.SH', startDate: '20200101', endDate: '20260901', rows: 42 }],
    });
    expect(database.indexDailyBasic.findMany).not.toHaveBeenCalled();
  });

  it('normalizes valuation codes and retains missing-data errors', async () => {
    const response = await request('/indices/000300.sh/valuation');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(database.indexDailyBasic.findMany.mock.calls[0][0].where).toEqual({
      tsCode: '000300.SH',
    });
    vi.clearAllMocks();
    expect((await request('/indices/unknown/valuation')).status).toBe(404);
    expect(database.indexDailyBasic.findMany).not.toHaveBeenCalled();
  });

  it('preserves the legacy index-series date defaults and empty response', async () => {
    const response = await request('/indices/000300.SH/series');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ points: [] });
    expect(database.indexDaily.findMany.mock.calls[0][0].where).toEqual({
      tsCode: '000300.SH',
      tradeDate: { gte: '20150101', lte: '20261231' },
    });
  });

  it('selects the mapped delivery contract on each session and omits unavailable bars', async () => {
    database.futureMapping.findMany.mockResolvedValue([
      { tradeDate: '20260901', mappedTsCode: 'IF2609.CFX' },
      { tradeDate: '20260902', mappedTsCode: 'IF2610.CFX' },
      { tradeDate: '20260903', mappedTsCode: 'IF2610.CFX' },
    ]);
    const bar = { open: 100, high: 110, low: 90, volume: 123 };
    database.futureDaily.findMany.mockResolvedValue([
      { ...bar, tsCode: 'IF2609.CFX', tradeDate: '20260901', close: 101 },
      { ...bar, tsCode: 'IF2609.CFX', tradeDate: '20260902', close: 999 },
      { ...bar, tsCode: 'IF2610.CFX', tradeDate: '20260902', close: 102 },
    ]);
    const response = await request('/futures/IF.CFX/series?start=20260901&end=20260903');
    expect(response.status).toBe(200);
    const expectedBar = { open: 100, high: 110, low: 90, vol: 123, pe: null, adjFactor: null };
    expect(await response.json()).toEqual({
      tsCode: 'IF.CFX',
      name: 'IF.CFX',
      points: [
        { ...expectedBar, date: '20260901', close: 101 },
        { ...expectedBar, date: '20260902', close: 102 },
      ],
    });
  });

  it('returns not found for a future with no mapped or direct bars', async () => {
    const response = await request('/futures/IF2609.CFX/series');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
