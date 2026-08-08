import { describe, expect, it } from 'vitest';
import {
  governmentYieldCurveCoverageReady,
  governmentYieldTermsFromDependencies,
} from './signal-readiness.js';

const dependency = {
  factorId: 'factor-1',
  key: 'cgb_curve_slope',
  name: '国债期限利差',
  analysisKind: 'time_series' as const,
  codeHash: 'abc123',
  inputs: ['rates.cgb.yield.10y', 'rates.cgb.yield.2y', 'etf.adjustedClose'],
};

describe('government yield signal readiness', () => {
  it('extracts and deduplicates the frozen curve maturities', () => {
    expect(governmentYieldTermsFromDependencies([dependency, dependency])).toEqual([2, 10]);
    expect(
      governmentYieldTermsFromDependencies([{ ...dependency, inputs: ['etf.adjustedClose'] }]),
    ).toEqual([]);
  });

  it('requires every maturity to be available by the signal date and fresh', () => {
    expect(
      governmentYieldCurveCoverageReady([2, 10], '20260807', [
        { termYears: 2, availableDate: '20260806' },
        { termYears: 10, availableDate: '20260806' },
      ]),
    ).toBe(true);
    expect(
      governmentYieldCurveCoverageReady([2, 10], '20260807', [
        { termYears: 2, availableDate: '20260806' },
      ]),
    ).toBe(false);
    expect(
      governmentYieldCurveCoverageReady([10], '20260807', [
        { termYears: 10, availableDate: '20260723' },
      ]),
    ).toBe(false);
    expect(
      governmentYieldCurveCoverageReady([10], '20260807', [
        { termYears: 10, availableDate: '20260810' },
      ]),
    ).toBe(false);
  });
});
