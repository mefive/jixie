import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TushareClient } from '../providers/tushare/client.js';
import { recoverEtfRegistry } from './recovery.js';

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
vi.mock('../registry/etf-research-registry.js', () => ({ ETF_RESEARCH_CODES: ['510300.SH'] }));
vi.mock('./history-coverage.js', () => ({
  ETF_HISTORY_START: '20150101',
  inspectEtfHistoryCoverage: mocks.inspect,
}));
vi.mock('./sync.js', () => ({
  syncEtfMarketDate: mocks.revision,
  fillEtfHistoryGap: mocks.history,
}));
const recoveryOptions = {
  loadCompleted: async () => new Set(mocks.completed),
  onItemComplete: async (_scope: string, key: string) => {
    mocks.completed.add(key);
  },
};

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
    await recoverEtfRegistry({} as TushareClient, '20260909', [], recoveryOptions);
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
      recoverEtfRegistry(client, '20260909', ['20260908', '20260909'], {
        ...recoveryOptions,
        onProgress: progress,
      }),
    ).rejects.toThrow('provider unavailable');
    await recoverEtfRegistry(client, '20260909', ['20260908', '20260909'], {
      ...recoveryOptions,
      onProgress: progress,
    });
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
    await recoverEtfRegistry(client, '20260909', ['20260909'], recoveryOptions);
    mocks.inspect.mockResolvedValueOnce([
      {
        tradeDate: '20150105',
        activeCodes: ['510300.SH'],
        daily: [],
        adjustment: ['510300.SH'],
        shareSize: [],
      },
    ]);
    await recoverEtfRegistry(client, '20260909', ['20260909'], recoveryOptions);
    expect(mocks.history).toHaveBeenCalledOnce();
    expect(mocks.history.mock.calls[0][1].tradeDate).toBe('20150105');
    expect(mocks.revision).toHaveBeenCalledOnce();
  });
  it('retains source absences only within the caller recovery scope', async () => {
    mocks.inspect.mockImplementation(async (_database, _products, dates: string[]) =>
      dates.map((tradeDate) => ({
        tradeDate,
        activeCodes: ['510300.SH'],
        daily: ['510300.SH'],
        adjustment: [],
        shareSize: ['510300.SH'],
      })),
    );
    mocks.history.mockResolvedValue({
      missingDailyCodes: ['510300.SH'],
      missingShareSizeCodes: ['510300.SH'],
    });
    const client = {} as TushareClient;
    await recoverEtfRegistry(client, '20260909', [], recoveryOptions);
    const firstCalls = mocks.history.mock.calls.length;
    expect(firstCalls).toBe(3);
    await recoverEtfRegistry(client, '20260909', [], recoveryOptions);
    expect(mocks.history).toHaveBeenCalledTimes(firstCalls);
    mocks.completed.clear();
    await recoverEtfRegistry(client, '20260909', [], recoveryOptions);
    expect(mocks.history).toHaveBeenCalledTimes(firstCalls * 2);
  });

  it('stops on persistence failure before advancing recovery progress or later revisions', async () => {
    const progress = vi.fn();
    const client = {} as TushareClient;
    await expect(
      recoverEtfRegistry(client, '20260909', ['20260908', '20260909'], {
        ...recoveryOptions,
        onProgress: progress,
        onItemComplete: async () => {
          throw new Error('checkpoint failed');
        },
      }),
    ).rejects.toThrow('checkpoint failed');
    expect(mocks.revision).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledTimes(3);
    expect(mocks.completed.size).toBe(0);
    await recoverEtfRegistry(client, '20260909', ['20260908', '20260909'], recoveryOptions);
    expect(mocks.revision.mock.calls.map((call) => call[1])).toEqual([
      '20260908',
      '20260908',
      '20260909',
    ]);
  });
});
