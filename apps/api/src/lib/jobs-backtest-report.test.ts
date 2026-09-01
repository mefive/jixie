import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backtestReportUpdate: vi.fn(),
  jobUpdate: vi.fn(),
  strategyUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./prisma.js', () => ({
  prisma: {
    backtestReport: { update: mocks.backtestReportUpdate },
    job: { update: mocks.jobUpdate },
    strategy: { updateMany: mocks.strategyUpdateMany },
    $transaction: mocks.transaction,
  },
}));

import { finishBacktestReportJob } from './jobs.js';

describe('BacktestReport job finalization', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.backtestReportUpdate.mockReturnValue({ operation: 'report' });
    mocks.jobUpdate.mockReturnValue({ operation: 'job' });
    mocks.strategyUpdateMany.mockReturnValue({ operation: 'strategy' });
    mocks.transaction.mockResolvedValue([]);
  });

  it('persists the immutable report and latest Strategy cache in one transaction', async () => {
    const result = {
      name: '价值轮动',
      start: '20200101' as const,
      end: '20251231' as const,
      days: 100,
      initialCash: 1_000_000,
      finalValue: 1_200_000,
      totalReturn: 0.2,
      annReturn: 0.1,
      sharpe: 1.1,
      maxDrawdown: -0.12,
      trades: 2,
      tradeLog: [],
      nav: [{ date: '20200102', value: 1_000_000 }],
    };

    await finishBacktestReportJob('job-a', 'report-a', 'strategy-a', 'user-a', 'done', result);

    expect(mocks.backtestReportUpdate).toHaveBeenCalledWith({
      where: { id: 'report-a' },
      data: expect.objectContaining({
        status: 'done',
        payload: result,
        computedAt: expect.any(Date),
      }),
    });
    expect(mocks.strategyUpdateMany).toHaveBeenCalledWith({
      where: { id: 'strategy-a', userId: 'user-a' },
      data: { lastResult: result },
    });
    expect(mocks.transaction).toHaveBeenCalledWith([
      { operation: 'report' },
      { operation: 'job' },
      { operation: 'strategy' },
    ]);
  });

  it('records a failed report without replacing the last successful Strategy result', async () => {
    await finishBacktestReportJob(
      'job-a',
      'report-a',
      'strategy-a',
      'user-a',
      'error',
      undefined,
      'worker failed',
    );

    expect(mocks.backtestReportUpdate).toHaveBeenCalledWith({
      where: { id: 'report-a' },
      data: {
        status: 'error',
        payload: undefined,
        computedAt: null,
        error: 'worker failed',
      },
    });
    expect(mocks.strategyUpdateMany).not.toHaveBeenCalled();
  });
});
