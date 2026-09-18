import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertProductionLock, waitForRunningWork } from './coordination.js';
const counts = vi.hoisted(() => ({ jobs: vi.fn(), agents: vi.fn(), weather: vi.fn() }));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    job: { count: counts.jobs },
    agentTurn: { count: counts.agents },
    factorWeatherPin: { count: counts.weather },
  },
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('maintenance coordination', () => {
  it('requires the production lock while allowing local runs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JIXIE_MAINTENANCE_LOCK_HELD', '0');
    expect(assertProductionLock).toThrow('flock-protected');
    vi.stubEnv('JIXIE_MAINTENANCE_LOCK_HELD', '1');
    expect(assertProductionLock).not.toThrow();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('JIXIE_MAINTENANCE_LOCK_HELD', '0');
    expect(assertProductionLock).not.toThrow();
  });

  it('waits for a continuous quiet interval across all three work sources', async () => {
    vi.useFakeTimers();
    vi.stubEnv('MAINTENANCE_JOB_DRAIN_TIMEOUT_MS', '12000');
    vi.stubEnv('MAINTENANCE_JOB_QUIET_MS', '2000');
    counts.jobs.mockResolvedValue(0);
    counts.agents.mockResolvedValueOnce(1).mockResolvedValue(0);
    counts.weather.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValue(0);
    let settled = false;
    const waiting = waitForRunningWork(vi.fn()).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await waiting;
    expect(settled).toBe(true);
  });

  it('fails on timeout while work remains active', async () => {
    vi.useFakeTimers();
    vi.stubEnv('MAINTENANCE_JOB_DRAIN_TIMEOUT_MS', '2000');
    counts.jobs.mockResolvedValue(1);
    counts.agents.mockResolvedValue(0);
    counts.weather.mockResolvedValue(0);
    const rejected = expect(waitForRunningWork(vi.fn())).rejects.toThrow('Timed out waiting for 1');
    await vi.advanceTimersByTimeAsync(2000);
    await rejected;
  });
});
