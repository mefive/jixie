import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  source: vi.fn(),
  latest: vi.fn(),
  remove: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  validate: vi.fn(),
}));
vi.mock('../registry/index-presets.js', () => ({
  MARKET_WEATHER_INDICATOR_INDEX_CODES: ['000300.SH'],
}));
vi.mock('../providers/tushare/api.js', () => ({ indexWeight: fixture.source }));
vi.mock('../instruments/stock-identity.js', () => ({ canonicalStockCode: (code: string) => code }));
vi.mock('./daily-quality.js', () => ({ validateIndexWeightDate: fixture.validate }));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    indexWeight: {
      findFirst: fixture.latest,
      deleteMany: fixture.remove,
      createMany: fixture.insert,
    },
    $transaction: fixture.transaction,
  },
}));
import { prepareIndexMembership } from './prepare-membership.js';
import type { TushareClient } from '../providers/tushare/tushare-client.js';
const client = {} as TushareClient;
const snapshot = (date: string, weight = 100) => ({
  index_code: '000300.SH',
  con_code: '000001.SZ',
  trade_date: date,
  weight,
});

beforeEach(() => {
  vi.resetAllMocks();
  fixture.latest.mockResolvedValue(null);
  fixture.source.mockResolvedValue([]);
  fixture.transaction.mockResolvedValue([]);
});

describe('targeted index membership preparation', () => {
  it('writes July and August snapshots without importing the returned January history', async () => {
    fixture.source.mockImplementation(async (_client, input) =>
      [snapshot('20260130'), snapshot('20260731'), snapshot('20260831')].filter(
        (row) => row.trade_date <= input.end_date,
      ),
    );
    await prepareIndexMembership(client, ['20260731', '20260803', '20260831', '20260909'], 190);
    expect(
      fixture.insert.mock.calls.flatMap(([input]) =>
        input.data.map((row: { tradeDate: string }) => row.tradeDate),
      ),
    ).toEqual(['20260731', '20260831']);
    expect(fixture.source.mock.calls.map(([, input]) => input.start_date)).toEqual([
      '20260701',
      '20260801',
      '20260901',
    ]);
    expect(fixture.remove).toHaveBeenCalledWith({
      where: { indexCode: '000300.SH', tradeDate: '20260731' },
    });
    expect(fixture.validate).toHaveBeenCalledWith('20260909', 190);
  });

  it('selects only the nearest required preceding snapshot, retaining its real date', async () => {
    fixture.source.mockImplementation(async (_client, input) =>
      input.start_date === '20260701' ? [snapshot('20260701'), snapshot('20260731')] : [],
    );
    await prepareIndexMembership(client, ['20260813'], 190);
    expect(fixture.insert).toHaveBeenCalledOnce();
    expect(fixture.insert).toHaveBeenCalledWith({
      data: [{ indexCode: '000300.SH', conCode: '000001.SZ', tradeDate: '20260731', weight: 100 }],
    });
  });

  it('reuses a fresh local anchor when there is no monthly update', async () => {
    fixture.latest.mockResolvedValue({ tradeDate: '20260731' });
    await prepareIndexMembership(client, ['20260803'], 190);
    expect(fixture.source).toHaveBeenCalledOnce();
    expect(fixture.insert).not.toHaveBeenCalled();
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(fixture.validate).toHaveBeenCalledWith('20260803', 190);
  });

  it('does not treat a first September snapshot as an obligation to backfill earlier months', async () => {
    fixture.source.mockResolvedValue([snapshot('20260920')]);
    await prepareIndexMembership(client, ['20260920'], 190);
    expect(fixture.source).toHaveBeenCalledOnce();
    expect(fixture.insert).toHaveBeenCalledOnce();
    expect(fixture.validate).toHaveBeenCalledWith('20260920', 190);
  });

  it.each(['empty', 'future', 'stale'] as const)(
    'rejects %s data when no suitable target snapshot exists',
    async (mode) => {
      fixture.source.mockResolvedValue(mode === 'future' ? [snapshot('20260930')] : []);
      fixture.latest.mockResolvedValue(mode === 'stale' ? { tradeDate: '20260130' } : null);
      await expect(prepareIndexMembership(client, ['20260920'], 190)).rejects.toThrow(
        'no fresh as-of snapshot',
      );
      expect(fixture.insert).not.toHaveBeenCalled();
    },
  );

  it('propagates a source error even if local data is available', async () => {
    fixture.latest.mockResolvedValue({ tradeDate: '20260831' });
    fixture.source.mockRejectedValue(new Error('source unavailable'));
    await expect(prepareIndexMembership(client, ['20260920'], 190)).rejects.toThrow(
      'source unavailable',
    );
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it.each([[snapshot('20260731', 50)], [snapshot('20260731', 50), snapshot('20260731', 50)]])(
    'rejects incomplete or duplicated snapshots',
    async (...rows) => {
      fixture.source.mockResolvedValue(rows);
      await expect(prepareIndexMembership(client, ['20260731'], 190)).rejects.toThrow(
        'Invalid or incomplete',
      );
      expect(fixture.remove).not.toHaveBeenCalled();
    },
  );
});
