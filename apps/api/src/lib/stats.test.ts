import { describe, it, expect } from 'vitest';
import { groupDemean, residualize, spearman } from './stats.js';

describe('groupDemean', () => {
  it('subtracts the within-group mean', () => {
    const values = [1, 3, 10, 20];
    const groups = ['a', 'a', 'b', 'b'];
    // group a mean = 2 → [-1, 1]; group b mean = 15 → [-5, 5]
    expect(groupDemean(values, groups)).toEqual([-1, 1, -5, 5]);
  });

  it('leaves a singleton group at zero', () => {
    expect(groupDemean([7, 1, 3], ['solo', 'x', 'x'])).toEqual([0, -1, 1]);
  });
});

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

  it('size+industry: residual is orthogonal to both size and industry means (FWL)', () => {
    // Two industries with different baselines; factor = industry baseline + 3·logCap + noise.
    const n = 120;
    const groups = Array.from({ length: n }, (_, i) => (i < 60 ? 'bank' : 'tech'));
    const logCap = Array.from({ length: n }, (_, i) => 4 + (i % 60) * 0.05);
    const base = groups.map((g) => (g === 'bank' ? 10 : -4));
    const factor = logCap.map((c, i) => base[i] + 3 * c + (i % 5) * 0.002);
    const resid = residualize(factor, logCap, groups);
    // Residual means within each industry ≈ 0, and residual ⟂ size.
    const bankMean = resid.slice(0, 60).reduce((s, x) => s + x, 0) / 60;
    const techMean = resid.slice(60).reduce((s, x) => s + x, 0) / 60;
    expect(Math.abs(bankMean)).toBeLessThan(1e-9);
    expect(Math.abs(techMean)).toBeLessThan(1e-9);
    expect(Math.abs(spearman(resid, logCap))).toBeLessThan(0.2);
  });
});
