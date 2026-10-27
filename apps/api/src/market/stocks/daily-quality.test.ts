import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateStockDate } from './daily-quality.js';
const query = vi.hoisted(() => vi.fn());
vi.mock('#infra/database/prisma.js', async () => {
  const mocked = { prisma: { $queryRaw: query } };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});
const row = {
  daily: 1000n,
  adjustmentMatches: 980n,
  basicMatches: 850n,
  limitMatches: 850n,
  aliasedCodes: 0n,
};
beforeEach(() => {
  query.mockReset().mockResolvedValue([row]);
});

describe('stock date quality', () => {
  it('accepts the existing minimum coverage thresholds', async () => {
    expect(await validateStockDate('20260918')).toEqual({
      daily: 1000,
      adjustmentCoverage: 0.98,
      basicCoverage: 0.85,
      limitCoverage: 0.85,
    });
  });
  it.each(['adjustmentMatches', 'basicMatches', 'limitMatches'] as const)(
    'rejects insufficient %s coverage',
    async (column) => {
      query.mockResolvedValue([{ ...row, [column]: row[column] - 1n }]);
      await expect(validateStockDate('20260918')).rejects.toThrow('Core coverage failed');
    },
  );
  it('rejects data still stored under superseded identities', async () => {
    query.mockResolvedValue([{ ...row, aliasedCodes: 1n }]);
    await expect(validateStockDate('20260918')).rejects.toThrow('Superseded stock codes');
  });
});
