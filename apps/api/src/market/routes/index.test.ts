import { handleApiError } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marketRoute } from './index.js';

const database = vi.hoisted(() => ({
  stockBasic: { findMany: vi.fn() },
  etfBasic: { findMany: vi.fn() },
  indexDaily: { findMany: vi.fn() },
  indexDailyBasic: { groupBy: vi.fn(), findMany: vi.fn() },
}));
vi.mock('#infra/database/prisma.js', async () => {
  const mocked = { prisma: database };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

const app = new Hono().onError(handleApiError).route('/api/app/market', marketRoute);
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
  it('resolves cash asset names without retired future labels', async () => {
    database.stockBasic.findMany.mockResolvedValue([{ tsCode: '600519.SH', name: '贵州茅台' }]);
    database.etfBasic.findMany.mockResolvedValue([{ tsCode: '510300.SH', name: '沪深300ETF' }]);
    const response = await request('/instruments/names?codes=600519.SH,,510300.SH,IF.CFX,unknown');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      '600519.SH': '贵州茅台',
      '510300.SH': '沪深300ETF',
    });
    expect(database.stockBasic.findMany).toHaveBeenCalledWith({
      where: { tsCode: { in: ['600519.SH', '510300.SH', 'IF.CFX', 'unknown'] } },
      select: { tsCode: true, name: true },
    });
  });

  it('caps bulk names at 500 nonempty codes', async () => {
    const codes = Array.from({ length: 501 }, (_, index) => `code${index}`);
    const response = await request(`/instruments/names?codes=${codes.join(',')}`);
    expect(response.status).toBe(200);
    expect(database.stockBasic.findMany.mock.calls[0][0].where.tsCode.in).toEqual(
      codes.slice(0, 500),
    );
  });

  it.each([
    '/instruments/names',
    '/instruments/bond/example/series',
    '/instruments/future/IF.CFX/series',
    '/instruments/future/IF2609.CFX/series',
    '/instruments/stock/600519.SH/series?start=20260101&end=20260101',
    '/instruments/stock/600519.SH/series?start=invalid',
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
    const response = await request('/index-valuations');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      indices: [{ tsCode: '000300.SH', startDate: '20200101', endDate: '20260901', rows: 42 }],
    });
    expect(database.indexDailyBasic.findMany).not.toHaveBeenCalled();
  });

  it('normalizes valuation codes and retains missing-data errors', async () => {
    const response = await request('/index-valuations/000300.sh');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(database.indexDailyBasic.findMany.mock.calls[0][0].where).toEqual({
      tsCode: '000300.SH',
    });
    vi.clearAllMocks();
    expect((await request('/index-valuations/unknown')).status).toBe(404);
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

  it.each([
    ['zh', '不支持的证券类型'],
    ['en', 'Unsupported instrument type.'],
  ])('localizes unsupported instrument types in %s', async (locale, message) => {
    const response = await app.request('/api/app/market/instruments/bond/example/series', {
      headers: { 'accept-language': locale },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', message } });
  });

  it.each([
    '/names?codes=600519.SH',
    '/objects/stock/600519.SH/series',
    '/indices/valuation/catalog',
    '/indices/000300.SH/valuation',
    '/futures/IF.CFX/series',
    '/weather?dimension=industry&frequency=month',
    '/weather?dimension=unknown',
    '/industry-weather?frequency=month',
    '/state',
    '/state?scope=all',
  ])('removes the old read endpoint %s', async (path) => {
    expect((await request(path)).status).toBe(404);
    for (const table of Object.values(database)) {
      for (const query of Object.values(table)) {
        expect(query).not.toHaveBeenCalled();
      }
    }
  });
});
