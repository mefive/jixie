import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  etfShares: vi.fn(),
  indexValuation: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      etfShareSize: { findMany: mocks.etfShares },
      indexDailyBasic: { findMany: mocks.indexValuation },
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

import { loadResearchEtfShares, loadResearchIndexValuation } from './market-reference.js';

const request = { identifier: 'TEST', start: '20260101', end: '20261231' };

describe('Research market reference datasets', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue([]));
  });

  it('gates ETF share history by availability date', async () => {
    mocks.etfShares.mockResolvedValue([
      {
        availableDate: '20260106',
        tradeDate: '20260105',
        totalShare: 100,
        totalSize: 120,
        nav: 1.2,
        close: 1.19,
        exchange: 'SH',
      },
    ]);

    await expect(loadResearchEtfShares(request)).resolves.toEqual([
      expect.objectContaining({ date: '20260106', trade_date: '20260105', total_share_10k: 100 }),
    ]);
    expect(mocks.etfShares).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ availableDate: { gte: '20260101', lte: '20261231' } }),
      }),
    );
  });

  it('maps provider index valuation fields without reconstruction', async () => {
    mocks.indexValuation.mockResolvedValue([
      {
        tradeDate: '20260105',
        totalMv: 100,
        floatMv: 80,
        totalShare: 10,
        floatShare: 8,
        freeShare: 6,
        turnoverRate: 1.2,
        turnoverRateF: 1.5,
        pe: 12,
        peTtm: 11,
        pb: 1.4,
      },
    ]);

    await expect(loadResearchIndexValuation(request)).resolves.toEqual([
      expect.objectContaining({ date: '20260105', pe_ttm: 11, total_mv_cny: 100 }),
    ]);
  });
});
