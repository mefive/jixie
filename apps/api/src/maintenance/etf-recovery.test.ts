import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TushareClient } from '#market/providers/tushare/client.js';

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  history: vi.fn(),
  revision: vi.fn(),
  completed: new Set<string>(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: { etfBasic: { findMany: mocks.metadata } },
}));
vi.mock('#market/registry/etf-research-registry.js', () => ({ ETF_RESEARCH_CODES: ['510300.SH'] }));
vi.mock('#market/sync/etf-history.js', () => ({ syncEtfDaily: mocks.history }));
vi.mock('#market/sync/etf.js', () => ({ syncEtfMarketDate: mocks.revision }));
vi.mock('./state.js', () => ({
  completedMaintenanceItems: async () => new Set(mocks.completed),
  completeMaintenanceItem: async (_run: string, _stage: string, key: string) => {
    mocks.completed.add(key);
  },
}));
import { planEtfHistory, recoverEtfRegistry } from './etf-recovery.js';

beforeEach(() => {
  mocks.completed.clear();
  mocks.metadata
    .mockReset()
    .mockResolvedValue([{ tsCode: '510300.SH', listDate: '20120528', delistDate: null }]);
  mocks.history.mockReset().mockResolvedValue({});
  mocks.revision.mockReset().mockResolvedValue({});
});

describe('ETF recovery', () => {
  it('bounds history by the research start, lifecycle and publication waterline', () => {
    expect(
      planEtfHistory(
        [
          { tsCode: 'old', listDate: '20120528', delistDate: null },
          { tsCode: 'new', listDate: '20260910', delistDate: null },
          { tsCode: 'delisted', listDate: '20250101', delistDate: '20260201' },
        ],
        '20260909',
      ),
    ).toEqual([
      { tsCode: 'old', startDate: '20150101', endDate: '20260909' },
      { tsCode: 'delisted', startDate: '20250101', endDate: '20260201' },
    ]);
  });

  it('resumes after a failed revision without repeating completed history or dates', async () => {
    const client = {} as TushareClient;
    const progress = vi.fn().mockResolvedValue(undefined);
    mocks.revision
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(
      recoverEtfRegistry(client, 'run', '20260909', ['20260908', '20260909'], progress),
    ).rejects.toThrow('provider unavailable');
    await recoverEtfRegistry(client, 'run', '20260909', ['20260908', '20260909'], progress);
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.revision.mock.calls.map((call) => call[1])).toEqual([
      '20260908',
      '20260909',
      '20260909',
    ]);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });
});
