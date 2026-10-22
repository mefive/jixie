import { describe, expect, it } from 'vitest';
import {
  getStagingContext,
  stagingNow,
  stagingRequirements,
  withStagingContext,
  type StagingContext,
} from './staging-input.js';

const context: StagingContext = {
  id: 'CASE',
  directory: '/unused',
  formalUrl: 'file:/unused',
  timestamp: '2026-10-21T00:00:00.000Z',
  date: '20261021',
  upperBound: '20261020',
  requirements: { active: [], versioned: [] },
};

describe('candidate execution context', () => {
  it('freezes dates and requirements, restores nesting and rejects late access', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let delayed!: Promise<unknown>;
    await withStagingContext(context, async () => {
      expect(stagingNow().toISOString()).toBe(context.timestamp);
      expect(stagingRequirements()).toBe(context.requirements);
      await withStagingContext({ ...context, id: 'NESTED' }, async () => {
        expect(getStagingContext()?.id).toBe('NESTED');
      });
      expect(getStagingContext()?.id).toBe('CASE');
      delayed = gate.then(() => getStagingContext());
    });
    expect(getStagingContext()).toBeUndefined();
    const rejected = expect(delayed).rejects.toThrow('ended');
    release();
    await rejected;
  });
});
