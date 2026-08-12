import { describe, expect, it } from 'vitest';
import {
  automaticNeweyWestLag,
  leastSquaresCoefficients,
  neweyWestMeanInference,
  neweyWestRegression,
  populationZScores,
} from './inference.js';

describe('inference', () => {
  it('computes automatic Newey–West bandwidths with an overlap floor', () => {
    expect(automaticNeweyWestLag(100)).toBe(4);
    expect(automaticNeweyWestLag(4, 2)).toBe(2);
    expect(automaticNeweyWestLag(2, 5)).toBe(1);
  });

  it('reports HAC mean inference and a 95% confidence interval', () => {
    const result = neweyWestMeanInference([0.01, 0.02, 0.03, 0.04], 1);

    expect(result).not.toBeNull();
    expect(result!.estimate).toBeCloseTo(0.025);
    expect(result!.standardError).toBeGreaterThan(0);
    expect(result!.confidenceInterval.lower).toBeLessThan(result!.estimate);
    expect(result!.confidenceInterval.upper).toBeGreaterThan(result!.estimate);
    expect(result).toMatchObject({ observations: 4, lag: 1 });
  });

  it('does not count autocorrelated blocks as independent evidence', () => {
    const values = Array.from(
      { length: 100 },
      (_, index) => (Math.floor(index / 10) % 2 === 0 ? -1 : 1) + 0.25,
    );
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sampleVariance =
      values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
    const naiveT = average / Math.sqrt(sampleVariance / values.length);
    const robust = neweyWestMeanInference(values, automaticNeweyWestLag(values.length));

    expect(naiveT).toBeGreaterThan(1.96);
    expect(Math.abs(robust!.tStatistic)).toBeLessThan(1.96);
    expect(robust!.standardError).toBeGreaterThan(Math.sqrt(sampleVariance / values.length));
  });

  it('recovers multivariate OLS coefficients and rejects collinearity', () => {
    const design = [
      [1, -2, 1],
      [1, -1, -1],
      [1, 1, -2],
      [1, 2, 2],
    ];
    const response = design.map(
      ([intercept, first, second]) => intercept! * 0.5 + first! * 2 - second! * 3,
    );

    expect(leastSquaresCoefficients(design, response)).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.5, 10),
        expect.closeTo(2, 10),
        expect.closeTo(-3, 10),
      ]),
    );
    expect(
      leastSquaresCoefficients(
        design.map(([intercept, first]) => [intercept!, first!, first! * 2]),
        response,
      ),
    ).toBeNull();
  });

  it('uses the shared regression sandwich for a predictive slope', () => {
    const xs = [-2, -1, 1, 2];
    const ys = xs.map((value) => value * 0.02);
    const result = neweyWestRegression(
      xs.map((value) => [1, value]),
      ys,
      2,
    );

    expect(result?.coefficients[1]).toBeCloseTo(0.02);
    expect(result?.tStatistics[1]).toBe(0);
  });

  it('standardizes a cross-section and rejects constant exposures', () => {
    const result = populationZScores([1, 2, 3]);

    expect(result?.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0);
    expect(
      result && result.reduce((sum, value) => sum + value * value, 0) / result.length,
    ).toBeCloseTo(1);
    expect(populationZScores([1, 1, 1])).toBeNull();
  });
});
