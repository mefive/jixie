import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertProductionLock, waitForRunningWork } from './coordination.js';

afterEach(() => vi.unstubAllEnvs());
describe('workflow isolation', () => {
  it('does not grant ownership from an environment boolean', () => {
    vi.stubEnv('JIXIE_MAINTENANCE_LOCK_HELD', '1');
    expect(assertProductionLock).toThrow('actual coordinator ownership');
  });
  it('does not drain queued rows from a formal workflow', async () => {
    await expect(waitForRunningWork(vi.fn())).rejects.toThrow('publication coordinator');
  });
  it('allows isolated preparation without waiting for formal users', async () => {
    vi.stubEnv('DATABASE_URL', 'file:/tmp/jixie-isolation/maintenance-staging/TEST/candidate.db');
    vi.stubEnv('JIXIE_STAGING_DATABASE', process.env.DATABASE_URL!);
    vi.stubEnv('JIXIE_FORMAL_DATABASE_URL', 'file:/tmp/jixie-isolation/formal.db');
    vi.stubEnv('JIXIE_MAINTENANCE_CANDIDATE', 'TEST');
    expect(assertProductionLock).not.toThrow();
    await waitForRunningWork(vi.fn());
  });
});
