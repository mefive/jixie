import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TushareClient } from '../tushare/client.js';

const mocks = vi.hoisted(() => ({
  etfShareSize: vi.fn(),
  fundAdj: vi.fn(),
  fundDaily: vi.fn(),
  etfBasicFindMany: vi.fn(),
  tradeCalFindFirst: vi.fn(),
  dailyDeleteMany: vi.fn(),
  dailyCreateMany: vi.fn(),
  adjustmentDeleteMany: vi.fn(),
  adjustmentCreateMany: vi.fn(),
  shareSizeDeleteMany: vi.fn(),
  shareSizeCreateMany: vi.fn(),
}));

vi.mock('../tushare/api.js', () => ({
  etfShareSize: mocks.etfShareSize,
  fundAdj: mocks.fundAdj,
  fundDaily: mocks.fundDaily,
}));

vi.mock('../lib/prisma.js', () => {
  const database = {
    etfBasic: { findMany: mocks.etfBasicFindMany },
    tradeCal: { findFirst: mocks.tradeCalFindFirst },
    etfDaily: {
      deleteMany: mocks.dailyDeleteMany,
      createMany: mocks.dailyCreateMany,
    },
    etfAdjFactor: {
      deleteMany: mocks.adjustmentDeleteMany,
      createMany: mocks.adjustmentCreateMany,
    },
    etfShareSize: {
      deleteMany: mocks.shareSizeDeleteMany,
      createMany: mocks.shareSizeCreateMany,
    },
  };
  return {
    prisma: {
      ...database,
      $transaction: vi.fn(async (operation) => operation(database)),
    },
  };
});

const { fetchAllFundAdjForDate, syncEtfMarketDate } = await import('./etf-market-sync.js');
const client = {} as TushareClient;

describe('ETF market date synchronization', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.etfBasicFindMany.mockResolvedValue([
      { tsCode: '510300.SH', listDate: '20120528', delistDate: null },
    ]);
    mocks.tradeCalFindFirst.mockResolvedValue({ calDate: '20260824' });
    mocks.dailyDeleteMany.mockResolvedValue({ count: 0 });
    mocks.dailyCreateMany.mockResolvedValue({ count: 1 });
    mocks.adjustmentDeleteMany.mockResolvedValue({ count: 0 });
    mocks.adjustmentCreateMany.mockResolvedValue({ count: 1 });
    mocks.shareSizeDeleteMany.mockResolvedValue({ count: 0 });
    mocks.shareSizeCreateMany.mockResolvedValue({ count: 1 });
  });

  it('paginates fund_adj until a short page', async () => {
    mocks.fundAdj
      .mockResolvedValueOnce(
        Array.from({ length: 2_000 }, (_, index) => ({
          ts_code: `${String(index).padStart(6, '0')}.SH`,
          trade_date: '20260821',
          adj_factor: 1,
        })),
      )
      .mockResolvedValueOnce([{ ts_code: '510300.SH', trade_date: '20260821', adj_factor: 2 }]);

    await expect(fetchAllFundAdjForDate(client, '20260821')).resolves.toHaveLength(2_001);
    expect(mocks.fundAdj).toHaveBeenNthCalledWith(2, client, {
      trade_date: '20260821',
      offset: 2_000,
      limit: 2_000,
    });
  });

  it('publishes price, adjustment, and share size together with next-SSE availability', async () => {
    mocks.fundDaily.mockResolvedValue([
      {
        ts_code: '510300.SH',
        trade_date: '20260821',
        open: 4,
        high: 4.1,
        low: 3.9,
        close: 4.05,
        pre_close: 4,
        change: 0.05,
        pct_chg: 1.25,
        vol: 10,
        amount: 20,
      },
    ]);
    mocks.fundAdj.mockResolvedValue([
      { ts_code: '510300.SH', trade_date: '20260821', adj_factor: 5 },
    ]);
    mocks.etfShareSize.mockResolvedValue([
      {
        ts_code: '510300.SH',
        trade_date: '20260821',
        etf_name: 'CSI 300 ETF',
        total_share: 1_000,
        total_size: 4_050,
        nav: 4.04,
        close: 4.05,
        exchange: 'SSE',
      },
    ]);

    await expect(syncEtfMarketDate(client, '20260821', ['510300.SH'])).resolves.toEqual({
      tradeDate: '20260821',
      availableDate: '20260824',
      requestedCodes: 1,
      activeCodes: 1,
      daily: 1,
      adjustment: 1,
      shareSize: 1,
      missingDailyCodes: [],
    });
    expect(mocks.shareSizeCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tsCode: '510300.SH',
          tradeDate: '20260821',
          availableDate: '20260824',
          totalShare: 1_000,
          totalSize: 4_050,
        }),
      ],
    });
  });

  it('publishes a small, explicit no-bar gap when adjustment and share-size coverage remain complete', async () => {
    mocks.fundDaily.mockResolvedValue([]);
    mocks.fundAdj.mockResolvedValue([
      { ts_code: '510300.SH', trade_date: '20260821', adj_factor: 5 },
    ]);
    mocks.etfShareSize.mockResolvedValue([
      {
        ts_code: '510300.SH',
        trade_date: '20260821',
        etf_name: 'CSI 300 ETF',
        total_share: 1_000,
        total_size: 4_050,
        nav: 4.04,
        close: 4.05,
        exchange: 'SSE',
      },
    ]);

    await expect(syncEtfMarketDate(client, '20260821', ['510300.SH'])).resolves.toMatchObject({
      daily: 0,
      adjustment: 1,
      shareSize: 1,
      missingDailyCodes: ['510300.SH'],
    });
    expect(mocks.dailyDeleteMany).toHaveBeenCalled();
  });

  it('fails before publication when a required adjustment factor is absent upstream', async () => {
    mocks.fundDaily.mockResolvedValue([
      {
        ts_code: '510300.SH',
        trade_date: '20260821',
        open: 4,
        high: 4.1,
        low: 3.9,
        close: 4.05,
        pre_close: 4,
        change: 0.05,
        pct_chg: 1.25,
        vol: 10,
        amount: 20,
      },
    ]);
    mocks.fundAdj.mockResolvedValue([]);
    mocks.etfShareSize.mockResolvedValue([
      {
        ts_code: '510300.SH',
        trade_date: '20260821',
        etf_name: 'CSI 300 ETF',
        total_share: 1_000,
        total_size: 4_050,
        nav: 4.04,
        close: 4.05,
        exchange: 'SSE',
      },
    ]);

    await expect(syncEtfMarketDate(client, '20260821', ['510300.SH'])).rejects.toThrow(
      /fund_adj missing ETF code/,
    );
    expect(mocks.dailyDeleteMany).not.toHaveBeenCalled();
  });

  it('fails closed when fund_daily has a broad gap instead of an isolated no-bar product', async () => {
    const codes = ['510050.SH', '510300.SH', '510500.SH'];
    mocks.etfBasicFindMany.mockResolvedValue(
      codes.map((tsCode) => ({ tsCode, listDate: '20150101', delistDate: null })),
    );
    mocks.fundDaily.mockResolvedValue([]);
    mocks.fundAdj.mockResolvedValue(
      codes.map((ts_code) => ({ ts_code, trade_date: '20260821', adj_factor: 5 })),
    );
    mocks.etfShareSize.mockResolvedValue(
      codes.map((ts_code) => ({
        ts_code,
        trade_date: '20260821',
        etf_name: ts_code,
        total_share: 1_000,
        total_size: 4_050,
        nav: 4.04,
        close: 4.05,
        exchange: 'SSE',
      })),
    );

    await expect(syncEtfMarketDate(client, '20260821', codes)).rejects.toThrow(
      /fund_daily missing 3\/3 ETF code/,
    );
    expect(mocks.dailyDeleteMany).not.toHaveBeenCalled();
  });
});
