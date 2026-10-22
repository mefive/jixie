import { describe, expect, it, vi } from 'vitest';
import { getDatabase, withDatabase, type Prisma } from '#infra/database/prisma.js';
import { executeMarketSync } from './dispatch.js';
const calls = vi.hoisted(() => ({ stock: vi.fn(), basic: vi.fn() }));
vi.mock('./stock-prices.js', () => ({ runSyncTask: calls.stock }));
vi.mock('./basic.js', () => ({ runSyncTask: calls.basic }));

describe('callable sync dispatch', () => {
  it('runs repeated tasks with explicit args and the current database, without changing argv or closing the client', async () => {
    const formal = { $disconnect: vi.fn() } as unknown as Prisma;
    const candidate = { $disconnect: vi.fn() } as unknown as Prisma;
    const seen: Prisma[] = [];
    const argv = [...process.argv];
    calls.stock.mockImplementation(async () => {
      seen.push(getDatabase());
    });
    calls.basic.mockImplementation(async () => {
      seen.push(getDatabase());
    });
    await withDatabase(formal, () => executeMarketSync(['stock-prices', '20261019', '20261019']));
    await withDatabase(candidate, async () => {
      await executeMarketSync(['basic', '20261020', '20261020']);
      await executeMarketSync(['stock-prices', '20261021', '20261021']);
    });
    expect(seen).toEqual([formal, candidate, candidate]);
    expect(calls.stock.mock.calls).toEqual([
      [['20261019', '20261019']],
      [['20261021', '20261021']],
    ]);
    expect(process.argv).toEqual(argv);
    expect(formal.$disconnect).not.toHaveBeenCalled();
    expect(candidate.$disconnect).not.toHaveBeenCalled();
  });
});
