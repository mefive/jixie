import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ revision: 7, start: vi.fn() }));
vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: { marketDataState: { findUnique: async () => ({ revision: fixture.revision }) } },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});
vi.mock('#infra/coordination/market-access.js', () => ({
  withMarketAccess: async (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('./research-sandbox.js', () => ({ ResearchSandbox: { start: fixture.start } }));
import { ResearchSandboxPool } from './research-sandbox-pool.js';

let pool: ResearchSandboxPool;
const sandboxes: { close: ReturnType<typeof vi.fn>; isClosed: boolean }[] = [];
beforeEach(() => {
  fixture.revision = 7;
  fixture.start.mockReset().mockImplementation(async () => {
    const sandbox = { close: vi.fn(), isClosed: false };
    sandboxes.push(sandbox);
    return sandbox;
  });
  pool = new ResearchSandboxPool();
});
afterEach(() => {
  pool.close('document');
  sandboxes.length = 0;
});

describe('Research market revision invalidation', () => {
  it('reuses a same-revision session and replaces idle state after publication', async () => {
    const first = await pool.withSandbox('document', async (sandbox) => sandbox);
    expect(await pool.withSandbox('document', async (sandbox) => sandbox)).toBe(first);
    fixture.revision = 8;
    const second = await pool.withSandbox('document', async (sandbox) => sandbox);
    expect(second).not.toBe(first);
    expect(sandboxes[0].close).toHaveBeenCalledOnce();
    expect(fixture.start).toHaveBeenCalledTimes(2);
  });
});
