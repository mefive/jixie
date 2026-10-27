import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
} from '../registry/index-presets.js';
import { validateIndexDate, validateIndexWeightDate } from './daily-quality.js';
const database = vi.hoisted(() => ({
  daily: vi.fn(),
  basic: vi.fn(),
  weight: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      indexDaily: { findMany: database.daily },
      indexDailyBasic: { findMany: database.basic },
      indexWeight: { findFirst: database.weight },
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

beforeEach(() => {
  vi.resetAllMocks();
  database.daily.mockResolvedValue(DAILY_MAINTAINED_INDEX_CODES.map((tsCode) => ({ tsCode })));
  database.basic.mockResolvedValue(MAJOR_INDEX_DAILY_BASIC_CODES.map((tsCode) => ({ tsCode })));
  database.weight.mockResolvedValue({ tradeDate: '20260901' });
});

describe('index date quality', () => {
  it('accepts complete point-in-time constituent and index coverage', async () => {
    expect(await validateIndexDate('20260918')).toMatchObject({
      oldestIndexWeightSnapshot: '20260901',
    });
  });
  it('applies the caller freshness limit without reading maintenance configuration', async () => {
    await expect(validateIndexDate('20260918', 10)).rejects.toThrow('older than 10 days');
    await expect(validateIndexDate('20260918', 20)).resolves.toMatchObject({
      oldestIndexWeightSnapshot: '20260901',
    });
  });
  it('rejects missing historical weights', async () => {
    database.weight.mockResolvedValueOnce(null);
    await expect(validateIndexDate('20260918')).rejects.toThrow('no point-in-time snapshot');
  });
  it('validates constituent prerequisites without requiring daily bars', async () => {
    await expect(validateIndexWeightDate('20260918')).resolves.toBe('20260901');
    expect(database.daily).not.toHaveBeenCalled();
    expect(database.weight).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { indexCode: expect.any(String), tradeDate: { lte: '20260918' } },
      }),
    );
    await expect(validateIndexWeightDate('20260918', 10)).rejects.toThrow('older than 10 days');
  });
});
