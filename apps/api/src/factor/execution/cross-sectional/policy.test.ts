import { describe, expect, it } from 'vitest';
import { applyOutlierPolicy } from './policy.js';

describe('factor evaluation outliers', () => {
  it('supports no-op and winsorized outlier policies without changing row order', () => {
    const values = [100, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(
      applyOutlierPolicy(values, { method: 'none', tailFraction: 0.2, madThreshold: 5 }),
    ).toEqual(values);
    expect(
      applyOutlierPolicy(values, { method: 'winsor', tailFraction: 0.2, madThreshold: 5 }),
    ).toEqual([8, 1, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('clips robust MAD outliers while retaining ordinary observations', () => {
    const transformed = applyOutlierPolicy([1, 1, 2, 2, 100], {
      method: 'mad',
      tailFraction: 0.01,
      madThreshold: 2,
    });

    expect(transformed.slice(0, 4)).toEqual([1, 1, 2, 2]);
    expect(transformed[4]).toBeCloseTo(4.9652);
  });
});
