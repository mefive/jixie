import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jobFindMany: vi.fn(),
  jobUpdateMany: vi.fn(),
  factorReportUpdateMany: vi.fn(),
  backtestReportUpdateMany: vi.fn(),
  strategyScanReportUpdateMany: vi.fn(),
  signalRunUpdateMany: vi.fn(),
  researchCuratorRunUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

const { markRunningJobsStale } = await import('./jobs.js');

describe('job restart recovery', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        job: { findMany: mocks.jobFindMany, updateMany: mocks.jobUpdateMany },
        factorReport: { updateMany: mocks.factorReportUpdateMany },
        backtestReport: { updateMany: mocks.backtestReportUpdateMany },
        strategyScanReport: { updateMany: mocks.strategyScanReportUpdateMany },
        signalRun: { updateMany: mocks.signalRunUpdateMany },
        researchCuratorRun: { updateMany: mocks.researchCuratorRunUpdateMany },
      }),
    );
  });

  it('marks only running jobs stale and leaves durable queued jobs resumable', async () => {
    mocks.jobFindMany.mockResolvedValue([
      {
        factorReportId: 'factor-report',
        backtestReportId: null,
        strategyScanReportId: null,
        signalRunId: null,
        researchCuratorRunId: null,
      },
      {
        factorReportId: null,
        backtestReportId: 'backtest-report',
        strategyScanReportId: 'scan-report',
        signalRunId: 'signal-run',
        researchCuratorRunId: 'curator-run',
      },
    ]);
    mocks.factorReportUpdateMany.mockResolvedValue({ count: 1 });
    mocks.backtestReportUpdateMany.mockResolvedValue({ count: 1 });
    mocks.strategyScanReportUpdateMany.mockResolvedValue({ count: 1 });
    mocks.signalRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.researchCuratorRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.jobUpdateMany.mockResolvedValue({ count: 2 });

    await expect(markRunningJobsStale()).resolves.toBe(2);

    expect(mocks.jobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'running' } }),
    );
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith({
      where: { status: 'running' },
      data: { status: 'stale', finishedAt: expect.any(Date) },
    });
    expect(mocks.factorReportUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['factor-report'] }, status: 'running' } }),
    );
    expect(mocks.backtestReportUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['backtest-report'] }, status: 'running' },
      }),
    );
    expect(mocks.strategyScanReportUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['scan-report'] }, status: 'running' } }),
    );
    expect(mocks.signalRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['signal-run'] }, status: 'running' } }),
    );
    expect(mocks.researchCuratorRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['curator-run'] }, status: 'running' } }),
    );
  });
});
