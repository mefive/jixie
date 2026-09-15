import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeDate } from '@jixie/shared';
import type { TushareClient } from '../providers/tushare/client.js';

const mocks = vi.hoisted(() => ({
  daily: vi.fn(),
  adj: vi.fn(),
  marker: vi.fn(),
  deleteDaily: vi.fn(),
  deleteAdj: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('#infra/logging.js', () => ({ log: vi.fn() }));
vi.mock('../providers/tushare/api.js', () => ({
  fundDaily: mocks.daily,
  fundAdj: mocks.adj,
  fundBasic: vi.fn(),
  etfBasic: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    etfBasic: { findMany: vi.fn(async () => [{ tsCode: '510300.SH' }]) },
    tradeCal: { findMany: vi.fn(async () => [{ calDate: '20260908' }, { calDate: '20260909' }]) },
    etfSyncSlice: { findUnique: mocks.marker, upsert: vi.fn() },
    etfDaily: { count: vi.fn(async () => 1), deleteMany: mocks.deleteDaily, createMany: vi.fn() },
    etfAdjFactor: { count: vi.fn(async () => 1), deleteMany: mocks.deleteAdj, createMany: vi.fn() },
    $transaction: mocks.transaction,
  },
}));
import { syncEtfDaily } from './etf-history.js';

const recover = () =>
  syncEtfDaily(
    {} as TushareClient,
    ['510300.SH'],
    '20260908' as TradeDate,
    '20260909' as TradeDate,
    { validateCoverage: true },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.marker.mockResolvedValue({ tsCode: '510300.SH' });
  mocks.daily.mockResolvedValue([{ ts_code: '510300.SH', trade_date: '20260908', close: 1 }]);
  mocks.adj.mockResolvedValue([{ ts_code: '510300.SH', trade_date: '20260908', adj_factor: 1 }]);
  mocks.transaction.mockResolvedValue([]);
});

describe('ETF historical candidate validation', () => {
  it('rechecks an old marker and preserves stored data on incomplete upstream coverage', async () => {
    await expect(recover()).rejects.toThrow('1 missing adjustment dates');
    expect(mocks.adj).toHaveBeenCalledOnce();
    expect(mocks.deleteDaily).not.toHaveBeenCalled();
    expect(mocks.deleteAdj).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('stores a complete candidate and its checkpoint in one transaction', async () => {
    mocks.adj.mockResolvedValue([
      { ts_code: '510300.SH', trade_date: '20260908', adj_factor: 1 },
      { ts_code: '510300.SH', trade_date: '20260909', adj_factor: 1 },
    ]);
    expect(await recover()).toEqual({ daily: 1, adj: 2, skippedSlices: 0 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(5);
  });
});
