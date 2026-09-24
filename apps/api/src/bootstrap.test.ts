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
  weatherRecovery: vi.fn(),
  seed: vi.fn(),
}));
vi.mock('./server.js', () => ({ buildApp: mocks.buildApp }));
vi.mock('@hono/node-server', () => ({ serve: mocks.serve }));
vi.mock('#jobs/register.js', () => ({ registerJobLifecycles: mocks.register }));
vi.mock('#jobs/service.js', () => ({
  JobService: { recoverInterrupted: mocks.recovery, execute: mocks.execute },
}));
vi.mock('#jobs/scheduler.js', () => ({
  JobScheduler: { initialize: mocks.initialize, wake: mocks.startQueue },
}));
vi.mock('#agent/turns/records.js', () => ({
  markRunningAgentTurnsInterrupted: mocks.agentRecovery,
}));
vi.mock('#factor/weather/refresh.js', () => ({
  resetInterruptedFactorWeatherRefreshes: mocks.weatherRecovery,
}));
vi.mock('#factor/definitions/seed.js', () => ({ seedBuiltinFactors: mocks.seed }));
import { startServer } from './bootstrap.js';

describe('API bootstrap composition', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.buildApp.mockReturnValue({ fetch: vi.fn() });
    mocks.recovery.mockResolvedValue(0);
    mocks.agentRecovery.mockResolvedValue(0);
    mocks.weatherRecovery.mockResolvedValue(0);
    mocks.seed.mockResolvedValue(undefined);
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

  it('waits for recovery before queue startup and HTTP, without awaiting seeding', async () => {
    let finish!: (count: number) => void;
    mocks.recovery.mockReturnValue(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );
    mocks.seed.mockReturnValue(new Promise(() => {}));
    const pending = startServer(3101);
    await vi.waitFor(() => expect(mocks.agentRecovery).toHaveBeenCalledOnce());
    expect(mocks.startQueue).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
    finish(0);
    const app = await pending;
    expect(mocks.register.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recovery.mock.invocationCallOrder[0],
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
    await expect(startServer(3101)).rejects.toThrow('recovery failed');
    expect(mocks.startQueue).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
    expect(mocks.seed).not.toHaveBeenCalled();
  });

  it('reports seed failures without blocking startup', async () => {
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
});
