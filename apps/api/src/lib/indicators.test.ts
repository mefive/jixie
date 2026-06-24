import { describe, expect, it } from 'vitest';
import { kdj, smaAt } from './indicators.js';

describe('smaAt', () => {
  it('mean of the last `window` values', () => {
    expect(smaAt([1, 2, 3, 4, 5], 4, 3)).toBeCloseTo(4); // (3+4+5)/3
    expect(smaAt([1, 2, 3, 4, 5], 4, 5)).toBeCloseTo(3); // whole series
  });
  it('null when there is not enough history', () => {
    expect(smaAt([1, 2, 3], 2, 5)).toBeNull();
  });
});

describe('kdj', () => {
  it('rising series → elevated J near the end', () => {
    const n = 20;
    const close = Array.from({ length: n }, (_, i) => 10 + i);
    const high = close.map((c) => c + 0.5);
    const low = close.map((c) => c - 0.5);
    const { j } = kdj(high, low, close);
    expect(j.length).toBe(n);
    expect(j.at(-1)!).toBeGreaterThan(50);
  });

  it('flat range carries K forward (seeded at 50) → J stays 50', () => {
    const flat = Array(10).fill(5);
    const { j } = kdj(flat, flat, flat);
    expect(j.at(-1)!).toBeCloseTo(50, 5);
  });
});
