import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDerivedMarketRange } from './quality.js';
const database = vi.hoisted(() => ({
  market: vi.fn(),
  indices: vi.fn(),
  industries: vi.fn(),
  weights: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    marketIndicator: { findMany: database.market },
    indexIndicator: { count: database.indices },
    industryIndicator: { count: database.industries },
    indexWeight: { groupBy: database.weights },
  },
}));
const dates = ['20260917', '20260918'];
beforeEach(() => {
  vi.resetAllMocks();
  database.market.mockResolvedValue(
    dates.map((tradeDate) => ({
      tradeDate,
      advanceRatio: 0.5,
      aboveMa20Ratio: 0.6,
      aboveMa60Ratio: null,
    })),
  );
  database.indices.mockResolvedValue(3);
  database.industries.mockResolvedValue(40);
  database.weights.mockResolvedValue([
    { _min: { tradeDate: '20260917' } },
    { _min: { tradeDate: '20260918' } },
  ]);
});

describe('derived market quality', () => {
  it('counts index requirements from their first historical weights', async () => {
    expect(await validateDerivedMarketRange(dates[0], dates[1], dates)).toMatchObject({
      marketDates: 2,
      indexRows: 3,
      industryRows: 40,
    });
    database.indices.mockResolvedValue(2);
    await expect(validateDerivedMarketRange(dates[0], dates[1], dates)).rejects.toThrow(
      'expected at least 3',
    );
  });
  it('rejects a missing required date and invalid ratios', async () => {
    database.market.mockResolvedValueOnce([{ tradeDate: dates[0] }]);
    await expect(validateDerivedMarketRange(dates[0], dates[1], dates)).rejects.toThrow(
      'missing 20260918',
    );
    database.market.mockResolvedValue(
      dates.map((tradeDate) => ({ tradeDate, advanceRatio: 1.01 })),
    );
    await expect(validateDerivedMarketRange(dates[0], dates[1], dates)).rejects.toThrow(
      'outside [0, 1]',
    );
  });
});
