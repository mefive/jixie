import { describe, it, expect } from 'vitest';
import { residualize, spearman } from './stats.js';

describe('residualize (market-cap neutralization primitive)', () => {
  it('returns near-zero residuals when y is an exact linear function of x', () => {
    // y = 2·x + 5 exactly → nothing left after regressing y on x.
    const xs = [1, 2, 3, 4, 5, 6];
    const ys = xs.map((x) => 2 * x + 5);
    for (const r of residualize(ys, xs)) {
      expect(Math.abs(r)).toBeLessThan(1e-9);
    }
  });

  it('kills the size tilt: a factor that IS log-cap neutralizes to ~zero IC vs size', () => {
    // Simulate a cross-section where the factor value = log market cap + small idiosyncratic noise.
    // After size-neutralization the residual should be (almost) uncorrelated with size itself.
    const logCap = Array.from({ length: 200 }, (_, i) => 5 + i * 0.02);
    const factor = logCap.map((c, i) => c + (i % 7) * 0.001); // dominated by size
    const resid = residualize(factor, logCap);
    // Rank correlation of the residual with size should be far below the raw factor's (~1).
    expect(Math.abs(spearman(factor, logCap))).toBeGreaterThan(0.99);
    expect(Math.abs(spearman(resid, logCap))).toBeLessThan(0.2);
  });
});
