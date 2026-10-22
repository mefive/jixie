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
    const { withStagingContext } = await import('#infra/coordination/staging-input.js');
    await withStagingContext(
      {
        id: 'TEST',
        directory: '/tmp/unused',
        formalUrl: 'file:/tmp/unused/formal.db',
        timestamp: '2026-10-21T00:00:00Z',
        date: '20261021',
        upperBound: '20261020',
        requirements: { active: [], versioned: [] },
      },
      async () => {
        expect(assertProductionLock).not.toThrow();
        await waitForRunningWork(vi.fn());
      },
    );
  });
});
