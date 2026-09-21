import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    maintenanceRun: mocks,
    $transaction: async (operation: (transaction: unknown) => unknown) =>
      operation({ maintenanceRun: mocks }),
  },
}));
const { recordDailySourceWait, getPendingDailyRun } = await import('./state.js');
beforeEach(() => vi.resetAllMocks());

it.each(['error', 'running', 'done'])(
  'never converts an existing %s into a safe wait',
  async (status) => {
    mocks.findUnique.mockResolvedValue({ id: 'legacy', status });
    await recordDailySourceWait({
      startDate: '20260921',
      endDate: '20260921',
      trigger: 'timer',
      error: 'source pending',
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  },
);

it('creates an observable wait without a running/dirty interval', async () => {
  mocks.findUnique.mockResolvedValue(null);
  await recordDailySourceWait({
    startDate: '20260921',
    endDate: '20260921',
    trigger: 'timer',
    error: 'source pending',
  });
  expect(mocks.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      status: 'waiting',
      stage: 'waiting_source',
      targetKey: '20260921',
    }),
  });
});

it('selects the oldest unfinished target beyond the watermark rather than today', async () => {
  await getPendingDailyRun('20260918');
  expect(mocks.findFirst).toHaveBeenCalledWith({
    where: {
      kind: 'daily',
      status: { in: ['error', 'waiting'] },
      NOT: { targetKey: { startsWith: 'baseline:' } },
      endDate: { gt: '20260918' },
    },
    orderBy: { startedAt: 'asc' },
  });
});

it('retries a safe waiting row without changing its identity', async () => {
  mocks.findUnique.mockResolvedValue({ id: 'wait-1', status: 'waiting' });
  await recordDailySourceWait({
    startDate: '20260918',
    endDate: '20260918',
    trigger: 'timer',
    error: 'source pending',
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: 'wait-1' },
    data: expect.objectContaining({ status: 'waiting', attempts: { increment: 1 } }),
  });
});
