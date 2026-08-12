import { describe, expect, it } from 'vitest';
import { loadJobQueueConfig, selectFairQueuedJobs } from './job-queue.js';

describe('job queue fairness', () => {
  it('skips a saturated user instead of starving later users', () => {
    const selected = selectFairQueuedJobs(
      [
        { id: 'a-2', userId: 'a' },
        { id: 'a-3', userId: 'a' },
        { id: 'b-1', userId: 'b' },
        { id: 'c-1', userId: 'c' },
      ],
      new Map([['a', 1]]),
      2,
      1,
    );

    expect(selected.map((job) => job.id)).toEqual(['b-1', 'c-1']);
  });

  it('preserves FIFO order within the eligible set and honors multiple user slots', () => {
    const selected = selectFairQueuedJobs(
      [
        { id: 'a-1', userId: 'a' },
        { id: 'a-2', userId: 'a' },
        { id: 'b-1', userId: 'b' },
      ],
      new Map(),
      3,
      2,
    );

    expect(selected.map((job) => job.id)).toEqual(['a-1', 'a-2', 'b-1']);
  });
});

describe('job queue config', () => {
  it('uses safe defaults and accepts positive integer overrides', () => {
    expect(loadJobQueueConfig({})).toEqual({ concurrency: 2, perUserConcurrency: 1 });
    expect(
      loadJobQueueConfig({ JIXIE_JOB_CONCURRENCY: '4', JIXIE_JOB_PER_USER_CONCURRENCY: '2' }),
    ).toEqual({ concurrency: 4, perUserConcurrency: 2 });
    expect(
      loadJobQueueConfig({ JIXIE_JOB_CONCURRENCY: '0', JIXIE_JOB_PER_USER_CONCURRENCY: 'x' }),
    ).toEqual({ concurrency: 2, perUserConcurrency: 1 });
  });
});
