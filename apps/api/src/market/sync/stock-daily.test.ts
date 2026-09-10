import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TushareClient } from '../providers/tushare/client.js';

const mocks = vi.hoisted(() => {
  const table = () => ({ deleteMany: vi.fn(), createMany: vi.fn() });
  return {
    daily: vi.fn(),
    adjFactor: vi.fn(),
    dailyBasic: vi.fn(),
    stkLimit: vi.fn(),
    database: {
      daily: { ...table(), groupBy: vi.fn() },
      adjFactor: table(),
      dailyBasic: table(),
      stkLimit: table(),
      $transaction: vi.fn(),
    },
  };
});
vi.mock('../providers/tushare/api.js', () => ({
  daily: mocks.daily,
  adjFactor: mocks.adjFactor,
  dailyBasic: mocks.dailyBasic,
  stkLimit: mocks.stkLimit,
}));
vi.mock('#infra/database/prisma.js', () => ({ prisma: mocks.database }));
import { syncDailyCoreDate } from './stock-daily.js';

const client = {} as TushareClient;
const tradeDate = '20260901';
const identity = { ts_code: '600519.SH', trade_date: tradeDate };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.daily.mockResolvedValue([
    {
      ...identity,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      pre_close: 10,
      change: 1,
      pct_chg: 10,
      vol: 100,
      amount: 1000,
    },
  ]);
  mocks.adjFactor.mockResolvedValue([{ ...identity, adj_factor: 2 }]);
  mocks.dailyBasic.mockResolvedValue([{ ...identity, close: 11 }]);
  mocks.stkLimit.mockResolvedValue([{ ...identity, pre_close: 10, up_limit: 11, down_limit: 9 }]);
  mocks.database.daily.groupBy.mockResolvedValue([]);
  mocks.database.$transaction.mockResolvedValue([]);
});

function expectNoPublication() {
  expect(mocks.database.$transaction).not.toHaveBeenCalled();
  for (const name of ['daily', 'adjFactor', 'dailyBasic', 'stkLimit'] as const) {
    expect(mocks.database[name].deleteMany).not.toHaveBeenCalled();
    expect(mocks.database[name].createMany).not.toHaveBeenCalled();
  }
}

describe('daily stock publication gate', () => {
  it('publishes all four validated datasets in one replacement transaction', async () => {
    expect(await syncDailyCoreDate(client, tradeDate)).toEqual({
      tradeDate,
      daily: 1,
      adjustment: 1,
      basic: 1,
      limits: 1,
      priorMedianDaily: null,
    });
    expect(mocks.database.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.database.$transaction.mock.calls[0][0]).toHaveLength(8);
    for (const name of ['daily', 'adjFactor', 'dailyBasic', 'stkLimit'] as const) {
      expect(mocks.database[name].deleteMany).toHaveBeenCalledWith({ where: { tradeDate } });
      expect(mocks.database[name].createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ tsCode: '600519.SH', tradeDate })],
      });
    }
  });

  it('rejects missing adjustment coverage before deleting any published data', async () => {
    mocks.adjFactor.mockResolvedValue([]);
    await expect(syncDailyCoreDate(client, tradeDate)).rejects.toThrow('AdjFactor covers');
    expectNoPublication();
  });

  it('rejects truncated provider results against the recent market size', async () => {
    mocks.database.daily.groupBy.mockResolvedValue(
      Array.from({ length: 5 }, () => ({ _count: { _all: 100 } })),
    );
    await expect(syncDailyCoreDate(client, tradeDate)).rejects.toThrow('recent median is 100');
    expectNoPublication();
  });

  it('rejects a mismatched provider session before any publication', async () => {
    mocks.stkLimit.mockResolvedValue([{ ...identity, trade_date: '20260831' }]);
    await expect(syncDailyCoreDate(client, tradeDate)).rejects.toThrow('unexpected date');
    expectNoPublication();
  });
});
