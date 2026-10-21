import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '#infra/database/prisma.js';
import type { MarketRiskDriverQualitySummary } from '#market/state/market-risk-driver-quality.js';

const fixture = vi.hoisted(() => ({ inspect: vi.fn(), calendar: vi.fn() }));
vi.mock('#infra/database/prisma.js', () => ({ prisma: {} }));
vi.mock('#market/state/market-risk-driver-quality.js', async (original) => ({
  ...(await original<typeof import('#market/state/market-risk-driver-quality.js')>()),
  inspectMarketRiskDrivers: fixture.inspect,
}));
import { auditMarketRiskDrivers } from './risk-audit.js';

const database = { tradeCal: { findMany: fixture.calendar } } as unknown as Prisma;
const options = { startDate: '20260813', endDate: '20260909' };

function quality(completeObservations: number): MarketRiskDriverQualitySummary {
  return {
    expectedDates: 300,
    completeObservations,
    completeCoverage: completeObservations / 300,
    latestCompleteDate: options.endDate,
    trailingCompleteGaps: 0,
    factors: [],
    lineageErrors: [],
    coverageErrors: [],
    warnings: [],
  };
}

beforeEach(() => vi.resetAllMocks());

describe('market audit lookback for short repair ranges', () => {
  it('uses preceding actual sessions until the full complete-vector sample is available', async () => {
    fixture.inspect
      .mockResolvedValueOnce(quality(18))
      .mockResolvedValueOnce(quality(251))
      .mockResolvedValueOnce(quality(480));
    fixture.calendar
      .mockResolvedValueOnce([{ calDate: '20250801' }])
      .mockResolvedValueOnce([{ calDate: '20240801' }]);
    expect(await auditMarketRiskDrivers(options, database)).toMatchObject({
      status: 'pass',
      completeObservations: 480,
    });
    expect(fixture.inspect).toHaveBeenNthCalledWith(
      2,
      { startDate: '20250801', endDate: '20260909' },
      database,
    );
    expect(fixture.inspect).toHaveBeenNthCalledWith(
      3,
      { startDate: '20240801', endDate: '20260909' },
      database,
    );
    expect(fixture.calendar).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          exchange: 'SSE',
          isOpen: 1,
          calDate: { gte: '20180326', lt: '20260813', lte: '20260909' },
        },
        take: 252,
      }),
    );
  });

  it('retains readiness errors when earlier history does not exist', async () => {
    fixture.inspect.mockResolvedValue(quality(18));
    fixture.calendar.mockResolvedValue([]);
    expect(await auditMarketRiskDrivers(options, database)).toMatchObject({
      status: 'error',
      errors: ['only 18 complete observations are available'],
    });
    expect(fixture.inspect).toHaveBeenCalledOnce();
  });

  it('does not extend an already complete sample or erase lineage failures', async () => {
    fixture.inspect.mockResolvedValue({ ...quality(252), lineageErrors: ['invalid PIT lineage'] });
    expect(await auditMarketRiskDrivers(options, database)).toMatchObject({
      status: 'error',
      errors: ['invalid PIT lineage'],
    });
    expect(fixture.calendar).not.toHaveBeenCalled();
  });

  it('stops at the common driver history floor', async () => {
    fixture.inspect.mockResolvedValue(quality(18));
    expect(
      await auditMarketRiskDrivers({ ...options, startDate: '20180326' }, database),
    ).toMatchObject({ status: 'error' });
    expect(fixture.calendar).not.toHaveBeenCalled();
  });
});
