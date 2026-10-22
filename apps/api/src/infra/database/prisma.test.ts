import { describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDatabase, withDatabase, type Prisma } from './prisma.js';

const client = () => ({ $disconnect: vi.fn(async () => {}) }) as unknown as Prisma;

describe('database execution scope', () => {
  it('rejects unbound access and restores the outer client after a nested failure', async () => {
    const formal = client();
    const candidate = client();
    expect(() => getDatabase()).toThrow('execution scope');
    await withDatabase(formal, async () => {
      expect(getDatabase()).toBe(formal);
      await expect(
        withDatabase(candidate, async () => {
          expect(getDatabase()).toBe(candidate);
          throw new Error('candidate failure');
        }),
      ).rejects.toThrow('candidate failure');
      expect(getDatabase()).toBe(formal);
    });
    expect(() => getDatabase()).toThrow('execution scope');
  });

  it('isolates overlapping executions across awaits', async () => {
    const clients = [client(), client()];
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const first = withDatabase(clients[0], async () => {
      await gate;
      expect(getDatabase()).toBe(clients[0]);
    });
    await withDatabase(clients[1], async () => {
      await Promise.resolve();
      expect(getDatabase()).toBe(clients[1]);
      release();
      await first;
      expect(getDatabase()).toBe(clients[1]);
    });
  });

  it('leaves lifecycle ownership with the caller and rejects delayed work after close', async () => {
    const database = client();
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let delayed!: Promise<unknown>;
    await withDatabase(database, async () => {
      delayed = gate.then(() => getDatabase());
    });
    expect(database.$disconnect).not.toHaveBeenCalled();
    await closeDatabase(database);
    const rejected = expect(delayed).rejects.toThrow('execution scope');
    release();
    await rejected;
    await expect(withDatabase(database, async () => {})).rejects.toThrow('closed');
  });
});
