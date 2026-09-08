import { describe, expect, it } from 'vitest';
import { factorExecutionFrameSchema } from './protocol.js';

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
