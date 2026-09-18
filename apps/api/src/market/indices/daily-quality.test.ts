import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
} from '../registry/index-presets.js';
import { validateIndexDate } from './daily-quality.js';
const database = vi.hoisted(() => ({
  daily: vi.fn(),
  basic: vi.fn(),
  industry: vi.fn(),
  members: vi.fn(),
  weight: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    indexDaily: { findMany: database.daily },
    indexDailyBasic: { findMany: database.basic },
    swIndexDaily: { findMany: database.industry },
    swIndustryMember: { groupBy: database.members },
    indexWeight: { findFirst: database.weight },
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  database.daily.mockResolvedValue(DAILY_MAINTAINED_INDEX_CODES.map((tsCode) => ({ tsCode })));
  database.basic.mockResolvedValue(MAJOR_INDEX_DAILY_BASIC_CODES.map((tsCode) => ({ tsCode })));
  database.industry.mockResolvedValue(
    Array.from({ length: 31 }, (_, index) => ({ tsCode: String(index) })),
  );
  database.members.mockResolvedValue(
    Array.from({ length: 20 }, (_, index) => ({ l1Code: String(index) })),
  );
  database.weight.mockResolvedValue({ tradeDate: '20260901' });
});

describe('index date quality', () => {
  it('accepts complete point-in-time membership and industry coverage', async () => {
    expect(await validateIndexDate('20260918')).toMatchObject({
      activeIndustries: 20,
      swIndexDaily: 31,
      oldestIndexWeightSnapshot: '20260901',
    });
  });
  it('applies the caller freshness limit without reading maintenance configuration', async () => {
    await expect(validateIndexDate('20260918', 10)).rejects.toThrow('older than 10 days');
    await expect(validateIndexDate('20260918', 20)).resolves.toMatchObject({
      oldestIndexWeightSnapshot: '20260901',
    });
  });
  it('rejects missing historical weights and incomplete industry coverage', async () => {
    database.weight.mockResolvedValueOnce(null);
    await expect(validateIndexDate('20260918')).rejects.toThrow('no point-in-time snapshot');
    database.industry.mockResolvedValue([]);
    await expect(validateIndexDate('20260918')).rejects.toThrow('0/31');
  });
});
