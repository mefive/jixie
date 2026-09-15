import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TushareClient } from '#market/providers/tushare/client.js';

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  history: vi.fn(),
  inspect: vi.fn(),
  revision: vi.fn(),
  completed: new Set<string>(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    etfBasic: { findMany: mocks.metadata },
    tradeCal: {
      findMany: async () => [
        { calDate: '20150105' },
        { calDate: '20260908' },
        { calDate: '20260909' },
      ],
    },
  },
}));
vi.mock('#market/registry/etf-research-registry.js', () => ({ ETF_RESEARCH_CODES: ['510300.SH'] }));
vi.mock('#market/quality/etf-history-coverage.js', () => ({
  ETF_HISTORY_START: '20150101',
  inspectEtfHistoryCoverage: mocks.inspect,
}));
vi.mock('#market/sync/etf.js', () => ({
  syncEtfMarketDate: mocks.revision,
  fillEtfHistoryGap: mocks.history,
}));
vi.mock('./state.js', () => ({
  completedMaintenanceItems: async () => new Set(mocks.completed),
  completeMaintenanceItem: async (_run: string, _stage: string, key: string) => {
    mocks.completed.add(key);
  },
}));
import { recoverEtfRegistry } from './etf-recovery.js';

beforeEach(() => {
  mocks.completed.clear();
  mocks.metadata
    .mockReset()
    .mockResolvedValue([{ tsCode: '510300.SH', listDate: '20120528', delistDate: null }]);
  mocks.history.mockReset().mockResolvedValue({ missingDailyCodes: [], missingShareSizeCodes: [] });
  mocks.inspect.mockReset().mockImplementation(async (_database, _products, dates: string[]) =>
    dates.map((tradeDate) => ({
      tradeDate,
      activeCodes: ['510300.SH'],
      daily: [],
      adjustment: [],
      shareSize: [],
    })),
  );
  mocks.revision.mockReset().mockResolvedValue({});
});

describe('ETF recovery', () => {
  it('scans old years even when there are no recent revision dates; complete history makes no source calls', async () => {
    await recoverEtfRegistry({} as TushareClient, 'run', '20260909', [], vi.fn());
    expect(mocks.inspect.mock.calls.map((call) => call[2])).toEqual([
      ['20150105'],
      ['20260908', '20260909'],
    ]);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
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
    expect(mocks.inspect).toHaveBeenCalledTimes(4);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.revision.mock.calls.map((call) => call[1])).toEqual([
      '20260908',
      '20260909',
      '20260909',
    ]);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it('rechecks new holes on retry despite completed revision checkpoints', async () => {
    const client = {} as TushareClient;
    await recoverEtfRegistry(client, 'run', '20260909', ['20260909'], vi.fn());
    mocks.inspect.mockResolvedValueOnce([
      {
        tradeDate: '20150105',
        activeCodes: ['510300.SH'],
        daily: [],
        adjustment: ['510300.SH'],
        shareSize: [],
      },
    ]);
    await recoverEtfRegistry(client, 'run', '20260909', ['20260909'], vi.fn());
    expect(mocks.history).toHaveBeenCalledOnce();
    expect(mocks.history.mock.calls[0][1].tradeDate).toBe('20150105');
    expect(mocks.revision).toHaveBeenCalledOnce();
  });
});
