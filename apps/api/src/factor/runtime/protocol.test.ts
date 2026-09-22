import { describe, expect, it } from 'vitest';
import { factorExecutionFrameSchema, typeScriptFactorExecutionFrameSchema } from './protocol.js';

describe('factor Python protocol', () => {
  it('requires finite, nullable Factor values without extra payload fields', () => {
    expect(
      factorExecutionFrameSchema.parse({
        type: 'factor_values',
        values: [1.2, null],
        first_error: null,
      }),
    ).toMatchObject({ type: 'factor_values' });
    expect(() =>
      factorExecutionFrameSchema.parse({
        type: 'factor_values',
        values: [Number.POSITIVE_INFINITY],
        first_error: null,
      }),
    ).toThrow();
  });
});

describe('TypeScript Factor log protocol', () => {
  it('accepts batches while preserving the existing longer TS log lines', () => {
    const batch = { type: 'log_batch', entries: [{ level: 'info', text: 'x'.repeat(30_000) }] };
    expect(typeScriptFactorExecutionFrameSchema.parse(batch)).toEqual(batch);
    expect(factorExecutionFrameSchema.safeParse(batch).success).toBe(false);
  });

  it.each([
    ['empty', { type: 'log_batch', entries: [] }],
    ['invalid level', { type: 'log_batch', entries: [{ level: 'warn', text: 'invalid level' }] }],
    [
      'extra entry fields',
      { type: 'log_batch', entries: [{ level: 'info', text: 'invalid entry', extra: true }] },
    ],
    [
      'too many entries',
      {
        type: 'log_batch',
        entries: Array.from({ length: 257 }, () => ({ level: 'info', text: 'too many' })),
      },
    ],
  ])('rejects a batch with %s', (_name, frame) => {
    expect(typeScriptFactorExecutionFrameSchema.safeParse(frame).success).toBe(false);
  });
});
