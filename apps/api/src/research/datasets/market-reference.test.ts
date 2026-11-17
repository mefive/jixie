import { getDatabase as fixtureDatabase } from '#infra/database/prisma.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  indexValuation: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      indexDailyBasic: { findMany: mocks.indexValuation },
    },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
    getApplicationDatabase: () => mocked.prisma,
  };
});

import { loadResearchIndexValuation } from './market-reference.js';

const request = { identifier: 'TEST', start: '20260101', end: '20261231' };

describe('Research market reference datasets', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue([]));
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

vi.mock('#infra/database/market-database.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#infra/database/market-database.js')>()),
  getMarketDatabase: () => fixtureDatabase(),
}));
