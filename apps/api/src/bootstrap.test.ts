import { getDatabase, type Prisma } from '#infra/database/prisma.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildApp: vi.fn(),
  serve: vi.fn(),
  startQueue: vi.fn(),
  register: vi.fn(),
  initialize: vi.fn(),
  execute: vi.fn(),
  recovery: vi.fn(),
  agentRecovery: vi.fn(),
  seed: vi.fn(),
  prune: vi.fn(),
  pruneStrategy: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./server.js', () => ({ buildApp: mocks.buildApp }));
vi.mock('@hono/node-server', () => ({ serve: mocks.serve }));
vi.mock('#jobs/register.js', () => ({ registerJobLifecycles: mocks.register }));
vi.mock('#jobs/job-service.js', () => ({
  JobService: { recoverInterrupted: mocks.recovery, execute: mocks.execute },
}));
vi.mock('#jobs/job-scheduler.js', () => ({
  JobScheduler: { initialize: mocks.initialize, wake: mocks.startQueue },
}));
vi.mock('#agent/turns/records.js', () => ({
  markRunningAgentTurnsInterrupted: mocks.agentRecovery,
}));
vi.mock('#factor/definitions/seed.js', () => ({ seedBuiltinFactors: mocks.seed }));
vi.mock('#factor/evaluations/retention.js', () => ({ pruneFactorReports: mocks.prune }));
vi.mock('#strategy/results/retention.js', () => ({ pruneStrategyResults: mocks.pruneStrategy }));
import { startServer } from './bootstrap.js';
const database = { $transaction: mocks.transaction } as unknown as Prisma;

describe('API bootstrap composition', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.buildApp.mockReturnValue({ fetch: vi.fn() });
    mocks.recovery.mockImplementation(async () => {
      expect(getDatabase()).toBe(database);
      return 0;
    });
    mocks.agentRecovery.mockResolvedValue(0);
    mocks.seed.mockResolvedValue(undefined);
    mocks.prune.mockResolvedValue(0);
    mocks.pruneStrategy.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation((run) => run(database));
  });

  it('does not schedule, recover or listen on module import', async () => {
    vi.resetModules();
    await import('./bootstrap.js');
    expect(mocks.serve).not.toHaveBeenCalled();
    expect(mocks.startQueue).not.toHaveBeenCalled();
    expect(mocks.recovery).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('waits for recovery, seed and report cleanup before queue startup and HTTP', async () => {
    let finish!: (count: number) => void;
    mocks.recovery.mockReturnValue(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );
    let finishSeed!: () => void;
    mocks.seed.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSeed = resolve;
      }),
    );
    let finishPrune!: (count: number) => void;
    mocks.prune.mockReturnValue(
      new Promise<number>((resolve) => {
        finishPrune = resolve;
      }),
    );
    const pending = startServer(3101, database);
    await vi.waitFor(() => expect(mocks.agentRecovery).toHaveBeenCalledOnce());
    expect(mocks.startQueue).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
    finish(0);
    await vi.waitFor(() => expect(mocks.seed).toHaveBeenCalledOnce());
    expect(mocks.prune).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
    finishSeed();
    await vi.waitFor(() => expect(mocks.prune).toHaveBeenCalledWith(database));
    expect(mocks.startQueue).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
    finishPrune(0);
    const app = await pending;
    expect(mocks.register.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recovery.mock.invocationCallOrder[0],
    );
    expect(mocks.pruneStrategy).toHaveBeenCalledWith(database);
    expect(mocks.pruneStrategy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startQueue.mock.invocationCallOrder[0],
    );
    expect(mocks.initialize).toHaveBeenCalledWith(mocks.execute);
    expect(mocks.serve).toHaveBeenCalledWith({ fetch: app.fetch, port: 3101 });
    expect(mocks.seed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startQueue.mock.invocationCallOrder[0],
    );
    expect(mocks.startQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.serve.mock.invocationCallOrder[0],
    );
  });

  it('does not start after recovery failure', async () => {
    mocks.recovery.mockRejectedValue(new Error('recovery failed'));
    await expect(startServer(3101, database)).rejects.toThrow('recovery failed');
    expect(mocks.startQueue).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
    expect(mocks.seed).not.toHaveBeenCalled();
  });

  it.each(['seed', 'prune', 'pruneStrategy'] as const)(
    'does not serve after %s failure',
    async (step) => {
      mocks[step].mockRejectedValue(new Error(`${step} failed`));
      await expect(startServer(3101, database)).rejects.toThrow(`${step} failed`);
      expect(mocks.startQueue).not.toHaveBeenCalled();
      expect(mocks.serve).not.toHaveBeenCalled();
    },
  );
});
