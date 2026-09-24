import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalsError } from '../errors.js';
import { generateDailySignals } from './scheduler.js';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  settle: vi.fn(),
  claim: vi.fn(),
  execute: vi.fn(),
}));
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
vi.mock('#jobs/service.js', () => ({ JobService: { claim: mocks.claim, execute: mocks.execute } }));
vi.mock('#jobs/register.js', () => ({ registerJobLifecycles: vi.fn() }));
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
  it('claims and executes each CLI job serially without starting the API scheduler', async () => {
    const order: string[] = [];
    mocks.enqueue.mockImplementation(async (_owner, deploymentId) => ({
      jobId: deploymentId,
      completion: Promise.resolve('done'),
    }));
    mocks.claim.mockImplementation(async (jobId) => {
      order.push(`claim:${jobId}`);
      return true;
    });
    mocks.execute.mockImplementation(async (jobId) => {
      order.push(`execute:${jobId}`);
    });
    await expect(generateDailySignals('20260917', vi.fn())).resolves.toEqual({
      deployments: 2,
      done: 2,
      errors: 0,
    });
    expect(order).toEqual(['claim:first', 'execute:first', 'claim:second', 'execute:second']);
  });

  it('waits for the owner after a lost claim and preserves jobless completed history', async () => {
    mocks.enqueue
      .mockResolvedValueOnce({ jobId: 'owned', completion: Promise.resolve('error') })
      .mockResolvedValueOnce({ jobId: null, completion: Promise.resolve('done') });
    mocks.claim.mockResolvedValue(false);
    await expect(generateDailySignals('20260917', vi.fn())).resolves.toEqual({
      deployments: 2,
      done: 1,
      errors: 1,
    });
    expect(mocks.claim).toHaveBeenCalledExactlyOnceWith('owned');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
