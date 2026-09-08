import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobExecutor } from './executor.js';

type Job = { id: string; userId: string; kind: string; status: string; payload: unknown };
const fixture = vi.hoisted(() => ({
  jobs: [] as Job[],
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock('../database/prisma.js', () => ({
  prisma: {
    job: {
      findMany: fixture.findMany,
      findUnique: fixture.findUnique,
      updateMany: fixture.updateMany,
    },
  },
}));

let release: Map<string, (error?: Error) => void>;
let run: ReturnType<typeof vi.fn>;
let onFailure: ReturnType<typeof vi.fn>;
let executor: Pick<JobExecutor, 'execute'>;
let queue: typeof import('./queue.js');
function add(id: string, userId: string, kind = 'backtest', payload: unknown = { frozen: id }) {
  fixture.jobs.push({ id, userId, kind, payload, status: 'queued' });
}

describe('queue execution with injected business handlers', () => {
  beforeEach(async () => {
    vi.resetModules();
    fixture.jobs = [];
    fixture.findMany
      .mockReset()
      .mockImplementation(async () => fixture.jobs.filter((job) => job.status === 'queued'));
    fixture.findUnique
      .mockReset()
      .mockImplementation(async ({ where }) => fixture.jobs.find((job) => job.id === where.id));
    fixture.updateMany.mockReset().mockImplementation(async ({ where }) => {
      const job = fixture.jobs.find((job) => job.id === where.id && job.status === 'queued');
      if (!job) {
        return { count: 0 };
      }
      job.status = 'running';
      return { count: 1 };
    });
    release = new Map();
    run = vi.fn(
      (id: string) =>
        new Promise<void>((resolve, reject) => {
          release.set(id, (error) => {
            release.delete(id);
            if (error) {
              reject(error);
            } else {
              fixture.jobs.find((job) => job.id === id)!.status = 'done';
              resolve();
            }
          });
        }),
    );
    onFailure = vi.fn(async (id: string) => {
      fixture.jobs.find((job) => job.id === id)!.status = 'error';
    });
    executor = {
      execute: async (id) => {
        try {
          await run(id);
        } catch (error) {
          await onFailure(id, error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    };
    vi.stubEnv('JIXIE_JOB_CONCURRENCY', '2');
    vi.stubEnv('JIXIE_JOB_PER_USER_CONCURRENCY', '1');
    queue = await import('./queue.js');
  });

  afterEach(async () => {
    // Finish every fixture task before discarding this module's scheduler state.
    await vi.waitFor(() => {
      for (const finish of [...release.values()]) {
        finish();
      }
      expect(fixture.jobs.some((job) => job.status === 'running')).toBe(false);
    });
    vi.unstubAllEnvs();
  });

  it('starts only when assembled, honors both concurrency limits and releases failed slots', async () => {
    add('a1', 'a');
    add('a2', 'a');
    add('b1', 'b');
    add('c1', 'c');
    queue.wakeJobQueue();
    await Promise.resolve();
    expect(fixture.findMany).not.toHaveBeenCalled();
    queue.startJobQueue(executor);
    await vi.waitFor(() => expect(run.mock.calls.map((call) => call[0])).toEqual(['a1', 'b1']));
    queue.wakeJobQueue();
    queue.wakeJobQueue();
    expect(run).toHaveBeenCalledTimes(2);
    release.get('b1')!();
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith('c1'));
    release.get('a1')!(new Error('worker failed'));
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith('a2'));
    expect(onFailure).toHaveBeenCalledWith('a1', 'worker failed');
    release.get('a2')!();
    release.get('c1')!();
    await vi.waitFor(() =>
      expect(fixture.jobs.filter((job) => job.status === 'done')).toHaveLength(3),
    );
  });

  it('passes only the claimed id to the executor, leaving payload interpretation to it', async () => {
    add('invalid-payload', 'owner', 'toString', null);
    queue.startJobQueue(executor);
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith('invalid-payload'));
    expect(fixture.findUnique).not.toHaveBeenCalled();
    release.get('invalid-payload')!();
  });
});
