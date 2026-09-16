import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TushareClient } from '#market/providers/tushare/client.js';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
} from '#market/registry/index-presets.js';

const state = vi.hoisted(() => ({
  repaired: new Set<string>(),
  writes: [] as string[],
  journal: [] as string[],
  noProgress: false,
}));
vi.mock('#market/stocks/daily-sync.js', () => ({ syncDailyCoreDate: vi.fn() }));
vi.mock('#market/stocks/flows-sync.js', () => ({ syncMoneyflow: vi.fn(), syncTopList: vi.fn() }));
vi.mock('./quality.js', () => ({ validateRawMarketDate: vi.fn() }));
vi.mock('#market/indices/sync.js', () => ({
  syncIndexDaily: async (_client: unknown, _code: string, date: string) => {
    expect(state.journal).toContain(date);
    state.writes.push(date);
    if (!state.noProgress) {
      state.repaired.add(date);
    }
  },
  syncIndexDailyBasic: vi.fn(),
  syncSwIndexDaily: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => {
  const counts = async ({ where }: { where: { tradeDate: { in: string[] } } }) =>
    where.tradeDate.in.map((tradeDate) => ({ tradeDate, _count: { _all: 5500 } }));
  return {
    prisma: {
      daily: { groupBy: counts },
      adjFactor: { groupBy: counts },
      dailyBasic: { groupBy: counts },
      stkLimit: { groupBy: counts },
      moneyflow: { groupBy: counts },
      swIndexDaily: { groupBy: counts },
      indexDaily: {
        findMany: async ({ where }: { where: { tradeDate: { in: string[] } } }) =>
          where.tradeDate.in.flatMap((tradeDate) =>
            DAILY_MAINTAINED_INDEX_CODES.filter(
              (code) => state.repaired.has(tradeDate) || code !== '000300.SH',
            ).map((tsCode) => ({ tradeDate, tsCode })),
          ),
      },
      indexDailyBasic: {
        findMany: async ({ where }: { where: { tradeDate: { in: string[] } } }) =>
          where.tradeDate.in.flatMap((tradeDate) =>
            MAJOR_INDEX_DAILY_BASIC_CODES.map((tsCode) => ({ tradeDate, tsCode })),
          ),
      },
    },
  };
});
import { selfHealMarketDates } from './self-heal.js';

beforeEach(() => {
  state.repaired.clear();
  state.writes = [];
  state.journal = [];
  state.noProgress = false;
});

describe('self-heal recovery', () => {
  const dates = Array.from(
    { length: 64 },
    (_, index) =>
      `2026${String(Math.floor(index / 20) + 1).padStart(2, '0')}${String((index % 20) + 1).padStart(2, '0')}`,
  );
  const options = {
    maxRepairDates: 20,
    drain: true,
    onLog: vi.fn(),
    beforeRepair: async (repair: { tradeDate: string }) => {
      state.journal.push(repair.tradeDate);
    },
  };
  it('drains 64 dates in one run and reports all four batches', async () => {
    const progress: number[] = [];
    const result = await selfHealMarketDates({} as TushareClient, dates, {
      ...options,
      onProgress: async (summary) => {
        progress.push(summary.repairedDates.length);
      },
    });
    expect(progress).toEqual([20, 40, 60, 64]);
    expect(result.repairedDates).toHaveLength(64);
    expect(result.deferredDates).toEqual([]);
    const writeCount = state.writes.length;
    await selfHealMarketDates({} as TushareClient, dates, options);
    expect(state.writes).toHaveLength(writeCount);
  });
  it('stops at the first unresolved date instead of consuming more batches', async () => {
    state.noProgress = true;
    await expect(selfHealMarketDates({} as TushareClient, dates, options)).rejects.toThrow(
      'insufficient progress',
    );
    expect(new Set(state.writes).size).toBe(1);
  });
});
