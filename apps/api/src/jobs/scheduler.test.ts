import { describe, expect, it } from 'vitest';
import { loadJobQueueConfig } from './scheduler.js';

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
