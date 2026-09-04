import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.fn();
const updateMany = vi.fn();
const updateRun = vi.fn();
const checkpointFindMany = vi.fn();
const checkpointUpsert = vi.fn();
const checkpointDeleteMany = vi.fn();
const findState = vi.fn();
const createState = vi.fn();
const updateState = vi.fn();
const runTransaction = vi.fn(async (input) =>
  typeof input === 'function'
    ? input({
        maintenanceState: {
          findUnique: findState,
          create: createState,
          update: updateState,
        },
      })
    : Promise.all(input),
);

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $transaction: runTransaction,
    maintenanceRun: { findFirst, updateMany, update: updateRun },
    maintenanceCheckpoint: {
      findMany: checkpointFindMany,
      upsert: checkpointUpsert,
      deleteMany: checkpointDeleteMany,
    },
    maintenanceState: { findUnique: findState },
  },
}));

const {
  completeMaintenanceItem,
  completedMaintenanceItems,
  finishMaintenanceRun,
  getMaintenanceStatus,
  initializeDailyWatermark,
  recoverInterruptedMaintenanceRuns,
} = await import('./state.js');

describe('maintenance status gate', () => {
  beforeEach(() => {
    findFirst.mockReset();
    updateMany.mockReset();
    updateRun.mockReset();
    checkpointFindMany.mockReset();
    checkpointUpsert.mockReset();
    checkpointDeleteMany.mockReset();
    findState.mockReset();
    createState.mockReset();
    updateState.mockReset();
  });

  it('exposes a running maintenance run and progress summary', async () => {
    findFirst
      .mockResolvedValueOnce({
        id: 'run-1',
        kind: 'daily',
        startDate: '20260729',
        endDate: '20260731',
        stage: 'market_state',
        summary: { completedDates: 2, totalDates: 3 },
        error: null,
        startedAt: new Date('2026-07-31T09:30:00Z'),
        heartbeatAt: new Date('2026-07-31T09:31:00Z'),
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    findState.mockResolvedValue({
      dailyPublishedThrough: '20260730',
      weeklySyncedThrough: null,
      dataRevision: 1,
    });

    const status = await getMaintenanceStatus();

    expect(status).toMatchObject({
      active: true,
      runId: 'run-1',
      stage: 'market_state',
      completedDates: 2,
      totalDates: 3,
      lastSuccessfulDailyDate: '20260730',
    });
  });

  it('uses a deployment run as the same App maintenance gate', async () => {
    findFirst
      .mockResolvedValueOnce({
        id: 'deploy-1',
        kind: 'deploy',
        startDate: null,
        endDate: null,
        stage: 'waiting_for_jobs',
        summary: null,
        error: null,
        startedAt: new Date('2026-07-31T09:30:00Z'),
        heartbeatAt: new Date('2026-07-31T09:30:00Z'),
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    findState.mockResolvedValue({
      dailyPublishedThrough: '20260730',
      weeklySyncedThrough: null,
      dataRevision: 1,
    });

    const status = await getMaintenanceStatus();

    expect(status).toMatchObject({
      active: true,
      runId: 'deploy-1',
      kind: 'deploy',
      stage: 'waiting_for_jobs',
    });
  });

  it('keeps the gate active after an unpublished daily failure', async () => {
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-2',
        kind: 'daily',
        startDate: '20260731',
        endDate: '20260731',
        stage: 'error',
        summary: { completedDates: 0, totalDates: 1 },
        error: 'candidate incomplete',
        startedAt: new Date('2026-07-31T09:30:00Z'),
        heartbeatAt: new Date('2026-07-31T09:31:00Z'),
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    findState.mockResolvedValue({
      dailyPublishedThrough: '20260730',
      weeklySyncedThrough: null,
      dataRevision: 1,
    });

    const status = await getMaintenanceStatus();

    expect(status.active).toBe(true);
    expect(status.error).toBe('candidate incomplete');
  });

  it('does not let an old failed run block an already-published watermark', async () => {
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-3',
        kind: 'daily',
        startDate: '20260730',
        endDate: '20260730',
        stage: 'error',
        summary: null,
        error: 'old failure',
        startedAt: new Date('2026-07-30T09:30:00Z'),
        heartbeatAt: new Date('2026-07-30T09:31:00Z'),
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    findState.mockResolvedValue({
      dailyPublishedThrough: '20260730',
      weeklySyncedThrough: null,
      dataRevision: 2,
    });

    const status = await getMaintenanceStatus();

    expect(status.active).toBe(false);
    expect(status.runId).toBeNull();
  });

  it('keeps a failed weekly refresh behind the Gate until a later weekly success', async () => {
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'weekly-1',
        kind: 'weekly',
        targetKey: '2026-W31',
        status: 'error',
        startDate: '20260731',
        endDate: '20260731',
        stage: 'error',
        summary: null,
        error: 'audit failed',
        startedAt: new Date('2026-07-31T01:00:00Z'),
        heartbeatAt: new Date('2026-07-31T01:05:00Z'),
      })
      .mockResolvedValueOnce(null);
    findState.mockResolvedValue({
      dailyPublishedThrough: '20260730',
      weeklySyncedThrough: '20260724',
      dataRevision: 2,
    });

    const status = await getMaintenanceStatus();

    expect(status.active).toBe(true);
    expect(status.kind).toBe('weekly');
    expect(status.error).toBe('audit failed');
  });

  it('marks lock-orphaned running rows as interrupted', async () => {
    updateMany.mockResolvedValue({ count: 2 });

    await expect(recoverInterruptedMaintenanceRuns()).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'running' },
        data: expect.objectContaining({ status: 'error', stage: 'interrupted' }),
      }),
    );
  });

  it('persists resumable per-item checkpoints', async () => {
    checkpointFindMany.mockResolvedValue([{ itemKey: '20251231' }, { itemKey: '20260331' }]);
    checkpointUpsert.mockResolvedValue({});

    await expect(completedMaintenanceItems('weekly-1', 'financial_statements')).resolves.toEqual(
      new Set(['20251231', '20260331']),
    );
    await completeMaintenanceItem('weekly-1', 'financial_statements', '20260630');

    expect(checkpointUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          runId_stage_itemKey: {
            runId: 'weekly-1',
            stage: 'financial_statements',
            itemKey: '20260630',
          },
        },
      }),
    );
  });

  it('clears checkpoints only after a successful terminal state', async () => {
    updateRun.mockResolvedValue({});
    checkpointDeleteMany.mockResolvedValue({ count: 2 });

    await finishMaintenanceRun('weekly-1', 'done');

    expect(checkpointDeleteMany).toHaveBeenCalledWith({ where: { runId: 'weekly-1' } });
  });

  it('treats repeated initialization at the same watermark as a no-op', async () => {
    findState.mockResolvedValue({ dailyPublishedThrough: '20260730' });

    await expect(initializeDailyWatermark('20260730')).resolves.toBeUndefined();
    expect(createState).not.toHaveBeenCalled();
    expect(updateState).not.toHaveBeenCalled();
  });

  it('refuses to replace an already-initialized watermark', async () => {
    findState.mockResolvedValue({ dailyPublishedThrough: '20260730' });

    await expect(initializeDailyWatermark('20260729')).rejects.toThrow(
      'dailyPublishedThrough is already initialized to 20260730',
    );
  });
});
