import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildApp: vi.fn(),
  serve: vi.fn(),
  startQueue: vi.fn(),
  recovery: vi.fn(),
  createExecutor: vi.fn(),
  execute: vi.fn(),
  agentRecovery: vi.fn(),
  weatherRecovery: vi.fn(),
  seed: vi.fn(),
  backtest: vi.fn(),
  factor: vi.fn(),
  scan: vi.fn(),
  signal: vi.fn(),
  curator: vi.fn(),
}));
vi.mock('./server.js', () => ({ buildApp: mocks.buildApp }));
vi.mock('@hono/node-server', () => ({ serve: mocks.serve }));
vi.mock('./infra/jobs/executor.js', () => ({ createJobExecutor: mocks.createExecutor }));
vi.mock('./infra/jobs/queue.js', () => ({ startJobQueue: mocks.startQueue }));
vi.mock('./agent/turns/records.js', () => ({
  markRunningAgentTurnsInterrupted: mocks.agentRecovery,
}));
vi.mock('./factor/weather/refresh.js', () => ({
  resetInterruptedFactorWeatherRefreshes: mocks.weatherRecovery,
}));
vi.mock('./factor/definitions/builtin-factors.js', () => ({ seedBuiltinFactors: mocks.seed }));
vi.mock('./strategy/backtest-job.js', () => ({ backtestJob: mocks.backtest }));
vi.mock('./factor/factor-job.js', () => ({ factorJob: mocks.factor }));
vi.mock('./strategy/scan-job.js', () => ({ strategyScanJob: mocks.scan }));
vi.mock('./signals/signal-job.js', () => ({ signalJob: mocks.signal }));
vi.mock('./research/curator-job.js', () => ({ researchCuratorJob: mocks.curator }));

import { startServer, jobRegistry } from './bootstrap.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('API bootstrap composition', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.buildApp.mockReturnValue({ fetch: vi.fn() });
    mocks.recovery.mockResolvedValue(0);
    mocks.createExecutor.mockReturnValue({
      execute: mocks.execute,
      recoverInterruptedJobs: mocks.recovery,
    });
    mocks.agentRecovery.mockResolvedValue(0);
    mocks.weatherRecovery.mockResolvedValue(0);
    mocks.seed.mockResolvedValue(undefined);
  });

  it('has no scheduling, recovery or listening side effects on import', async () => {
    vi.resetModules();
    await import('./bootstrap.js');
    expect(mocks.serve).not.toHaveBeenCalled();
    expect(mocks.startQueue).not.toHaveBeenCalled();
    expect(mocks.recovery).not.toHaveBeenCalled();
  });

  it('waits for all recovery before starting the queue and HTTP, but does not await seeding', async () => {
    const recovered = deferred<number>();
    const seeded = deferred<void>();
    mocks.recovery.mockReturnValue(recovered.promise);
    mocks.seed.mockReturnValue(seeded.promise);
    const pending = startServer(3101);
    await vi.waitFor(() => expect(mocks.agentRecovery).toHaveBeenCalledOnce());
    expect(mocks.startQueue).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
    recovered.resolve(0);
    const app = await pending;
    expect(mocks.serve).toHaveBeenCalledWith({ fetch: app.fetch, port: 3101 });
    expect(mocks.seed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startQueue.mock.invocationCallOrder[0],
    );
    expect(mocks.startQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.serve.mock.invocationCallOrder[0],
    );
    seeded.resolve();
  });

  it('does not start scheduling or HTTP when required recovery fails', async () => {
    mocks.recovery.mockRejectedValue(new Error('recovery failed'));
    await expect(startServer(3101)).rejects.toThrow('recovery failed');
    expect(mocks.startQueue).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
    expect(mocks.seed).not.toHaveBeenCalled();
  });

  it('keeps seed failures nonblocking and reports them', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.seed.mockRejectedValue(new Error('seed failed'));
      await startServer(3101);
      expect(mocks.serve).toHaveBeenCalledOnce();
      expect(logged).toHaveBeenCalledWith('[jixie] preset factor seed failed', expect.any(Error));
    } finally {
      logged.mockRestore();
    }
  });

  it('registers all durable kinds and injects one executor into the queue', async () => {
    await startServer(3101);
    expect(mocks.createExecutor).toHaveBeenCalledWith(jobRegistry);
    expect(mocks.startQueue).toHaveBeenCalledWith({
      execute: mocks.execute,
      recoverInterruptedJobs: mocks.recovery,
    });
    expect(Object.keys(jobRegistry)).toEqual([
      'backtest',
      'factor',
      'strategy-scan',
      'signal',
      'research-curator',
    ]);
    const cases = [
      ['backtest', mocks.backtest],
      ['factor', mocks.factor],
      ['strategy-scan', mocks.scan],
      ['signal', mocks.signal],
      ['research-curator', mocks.curator],
    ] as const;
    for (const [kind, definition] of cases) {
      expect(await jobRegistry[kind]()).toBe(definition);
    }
  });
});
