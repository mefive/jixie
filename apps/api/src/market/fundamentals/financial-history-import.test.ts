import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceSyncSummary } from './reference-sync.js';
import type { ReferenceWorkerStage } from './reference-worker-protocol.js';

const dependencies = vi.hoisted(() => ({
  stockCodesWithDailyData: vi.fn(),
  earliestDaily: vi.fn(),
  existingDividends: vi.fn(),
  disconnect: vi.fn(),
  worker: vi.fn<(stage: ReferenceWorkerStage, items: string[]) => Promise<ReferenceSyncSummary>>(),
}));

vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    daily: { findFirst: dependencies.earliestDaily },
    dividend: { findMany: dependencies.existingDividends },
    $disconnect: dependencies.disconnect,
  },
}));
vi.mock('../stocks/read.js', () => ({
  stockCodesWithDailyData: dependencies.stockCodesWithDailyData,
}));
vi.mock('./reference-worker-process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reference-worker-process.js')>()),
  runReferenceWorkerProcess: dependencies.worker,
}));

import { importFinancialReferenceHistory } from './financial-history-import.js';

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.stockCodesWithDailyData.mockResolvedValue(['000001.SZ', '600000.SH', '600001.SH']);
  dependencies.earliestDaily.mockResolvedValue({ tradeDate: '20250303' });
  dependencies.existingDividends.mockResolvedValue([{ tsCode: '600000.SH' }]);
  dependencies.worker.mockImplementation(async (_stage, items) => ({
    requested: items.length,
    processed: items.length,
    changed: items.length,
    created: items.length,
    skipped: 0,
    updated: 0,
    deleted: 0,
  }));
});

const options = {
  throughDate: '20250630',
  financialPeriodsPerProcess: 2,
  dividendCodesPerProcess: 1,
  onLog: () => {},
};

describe('financial reference history import', () => {
  it('uses market history, bounds batches and skips securities with existing dividends', async () => {
    const summary = await importFinancialReferenceHistory(options);
    expect(dependencies.worker.mock.calls).toEqual([
      ['financial_statements', ['20241231', '20250331']],
      ['financial_statements', ['20250630']],
      ['financials', ['20241231', '20250331']],
      ['financials', ['20250630']],
      ['dividends', ['000001.SZ']],
      ['dividends', ['600001.SH']],
    ]);
    expect(summary.financialStatements).toMatchObject({ requested: 3, processed: 3, created: 3 });
    expect(summary.financials).toMatchObject({ processed: 3, changed: 3 });
    expect(summary.dividends).toMatchObject({ processed: 2, changed: 2 });
    expect(dependencies.disconnect).not.toHaveBeenCalled();
  });

  it('fails without market history before starting any worker', async () => {
    dependencies.earliestDaily.mockResolvedValue(null);
    await expect(importFinancialReferenceHistory(options)).rejects.toThrow('Daily is empty');
    expect(dependencies.worker).not.toHaveBeenCalled();
    expect(dependencies.existingDividends).not.toHaveBeenCalled();
  });

  it('stops remaining stages and propagates worker failures to its caller', async () => {
    dependencies.worker.mockRejectedValueOnce(new Error('worker failed'));
    await expect(importFinancialReferenceHistory(options)).rejects.toThrow('worker failed');
    expect(dependencies.worker).toHaveBeenCalledTimes(1);
    expect(dependencies.disconnect).not.toHaveBeenCalled();
  });

  it('returns an empty dividend summary when all securities were imported', async () => {
    dependencies.existingDividends.mockResolvedValue([
      { tsCode: '000001.SZ' },
      { tsCode: '600000.SH' },
      { tsCode: '600001.SH' },
    ]);
    const result = await importFinancialReferenceHistory(options);
    expect(result.dividends).toEqual({
      requested: 0,
      processed: 0,
      changed: 0,
      created: 0,
      skipped: 0,
      updated: 0,
      deleted: 0,
    });
    expect(dependencies.worker.mock.calls.every(([stage]) => stage !== 'dividends')).toBe(true);
  });
});
