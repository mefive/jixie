import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalsError } from '../errors.js';
import { generateDailySignals } from './scheduler.js';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), settle: vi.fn() }));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    tradeCal: { findUnique: async () => ({ isOpen: 1 }) },
    strategyDeployment: {
      findMany: async () => [
        { id: 'first', userId: 'owner', strategyName: 'First' },
        { id: 'second', userId: 'owner', strategyName: 'Second' },
      ],
    },
  },
}));
vi.mock('../runs/enqueue.js', () => ({ enqueueSignalRun: mocks.enqueue }));
vi.mock('../accounting/settlement.js', () => ({ settleStrategyAccounts: mocks.settle }));
vi.mock('./sync.js', () => ({ syncSignalMarketData: vi.fn() }));

describe('Daily signal rejection handling', () => {
  beforeEach(() => vi.resetAllMocks());

  it('counts a business rejection and continues to the next deployment', async () => {
    mocks.enqueue
      .mockRejectedValueOnce(new SignalsError('paused'))
      .mockResolvedValueOnce({ completion: Promise.resolve('done') });
    const log = vi.fn();
    await expect(generateDailySignals('20260917', log)).resolves.toEqual({
      deployments: 2,
      done: 1,
      errors: 1,
    });
    expect(mocks.enqueue).toHaveBeenNthCalledWith(2, 'owner', 'second', '20260917');
    expect(log).toHaveBeenCalledWith('Skipped First: paused');
  });

  it('propagates infrastructure failures without misreporting them as a skipped deployment', async () => {
    const failure = new Error('Database unavailable');
    mocks.enqueue.mockRejectedValueOnce(failure);
    await expect(generateDailySignals('20260917', vi.fn())).rejects.toBe(failure);
    expect(mocks.enqueue).toHaveBeenCalledOnce();
  });
});
