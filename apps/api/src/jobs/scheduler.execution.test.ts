import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Job = { id: string; userId: string; kind: string; status: string; payload: unknown };
const fixture = vi.hoisted(() => ({
  jobs: [] as Job[],
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    job: {
      findFirst: fixture.findFirst,
      findUnique: fixture.findUnique,
      updateMany: fixture.updateMany,
    },
  },
}));

let release: Map<string, (error?: Error) => void>;
let run: ReturnType<typeof vi.fn>;
let onFailure: ReturnType<typeof vi.fn>;
let executor: { execute(jobId: string): Promise<void> };
let queue: typeof import('./scheduler.js');
function add(id: string, userId: string, kind = 'backtest', payload: unknown = { frozen: id }) {
  fixture.jobs.push({ id, userId, kind, payload, status: 'queued' });
}

describe('queue execution with injected business handlers', () => {
  beforeEach(async () => {
    vi.resetModules();
    fixture.jobs = [];
    fixture.findFirst
      .mockReset()
      .mockImplementation(async ({ where }) =>
        fixture.jobs.find(
          (job) => job.status === 'queued' && !where.userId.notIn.includes(job.userId),
        ),
      );
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
    queue = await import('./scheduler.js');
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
    queue.JobScheduler.wake();
    await Promise.resolve();
    expect(fixture.findFirst).not.toHaveBeenCalled();
    queue.JobScheduler.initialize(executor.execute);
    queue.JobScheduler.wake();
    await vi.waitFor(() => expect(run.mock.calls.map((call) => call[0])).toEqual(['a1', 'b1']));
    queue.JobScheduler.wake();
    queue.JobScheduler.wake();
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

  it('preserves eligible FIFO order with multiple slots per user', async () => {
    add('a1', 'a');
    add('a2', 'a');
    add('a3', 'a');
    add('b1', 'b');
    queue.JobScheduler.initialize(executor.execute, {
      concurrency: 3,
      perUserConcurrency: 2,
    });
    queue.JobScheduler.wake();
    await vi.waitFor(() =>
      expect(run.mock.calls.map((call) => call[0])).toEqual(['a1', 'a2', 'b1']),
    );
    release.get('a1')!();
    await vi.waitFor(() =>
      expect(run.mock.calls.map((call) => call[0])).toEqual(['a1', 'a2', 'b1', 'a3']),
    );
  });

  it('passes only the claimed id to the executor, leaving payload interpretation to it', async () => {
    add('invalid-payload', 'owner', 'toString', null);
    queue.JobScheduler.initialize(executor.execute);
    queue.JobScheduler.wake();
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith('invalid-payload'));
    expect(fixture.findUnique).not.toHaveBeenCalled();
    release.get('invalid-payload')!();
  });
});

describe('event wakeup interleavings', () => {
  it.each(['query', 'claim'] as const)('retains a wake during the %s await', async (phase) => {
    vi.resetModules();
    const queue = await import('./scheduler.js');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let offered = false;
    fixture.findFirst.mockReset().mockImplementation(async () => {
      if (phase === 'query' && !offered) {
        offered = true;
        await blocked;
        return null;
      }
      if (!offered || phase === 'query') {
        offered = true;
        return { id: 'one', userId: 'owner' };
      }
      return null;
    });
    fixture.updateMany.mockReset().mockImplementation(async () => {
      if (phase === 'claim') {
        await blocked;
      }
      return { count: 1 };
    });
    let finish!: () => void;
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    queue.JobScheduler.initialize(execute, { concurrency: 1, perUserConcurrency: 1 });
    queue.JobScheduler.wake();
    queue.JobScheduler.wake();
    await vi.waitFor(() =>
      expect(phase === 'query' ? fixture.findFirst : fixture.updateMany).toHaveBeenCalledOnce(),
    );
    queue.JobScheduler.wake();
    release();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    fixture.findFirst.mockResolvedValue(null);
    finish();
    await vi.waitFor(() => expect(fixture.findFirst.mock.calls.length).toBeGreaterThan(1));
    const calls = fixture.findFirst.mock.calls.length;
    queue.JobScheduler.wake();
    await vi.waitFor(() => expect(fixture.findFirst.mock.calls.length).toBeGreaterThan(calls));
  });
});

describe('process scheduler singleton', () => {
  it('initializes without dispatching and rejects a second initialization', async () => {
    vi.resetModules();
    const { JobScheduler } = await import('./scheduler.js');
    const execute = vi.fn(async () => {});
    const replacement = vi.fn(async () => {});
    fixture.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: 'singleton-job', userId: 'owner' })
      .mockResolvedValue(null);
    fixture.updateMany.mockReset().mockResolvedValue({ count: 1 });
    JobScheduler.wake();
    JobScheduler.initialize(execute, { concurrency: 1, perUserConcurrency: 1 });
    await Promise.resolve();
    expect(fixture.findFirst).not.toHaveBeenCalled();
    expect(() => JobScheduler.initialize(replacement)).toThrow('already initialized');
    JobScheduler.wake();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledExactlyOnceWith('singleton-job'));
    expect(replacement).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fixture.findFirst).toHaveBeenCalledTimes(2));
  });
});
