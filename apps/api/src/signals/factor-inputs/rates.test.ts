import { beforeEach, describe, expect, it, vi } from 'vitest';

const availability = vi.hoisted(() => vi.fn());
vi.mock('#market/rates/government-yield-availability.js', () => ({
  loadGovernmentYieldAvailability: availability,
}));

import {
  governmentYieldCurveCoverageReady,
  governmentYieldCurveReady,
  governmentYieldTermsFromDependencies,
} from './rates.js';

beforeEach(() => {
  availability.mockReset();
});

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

describe('signal yield admission policy', () => {
  it.each([
    ['20260724', true],
    ['20260723', false],
    ['20260807', true],
    ['20260808', false],
  ])('applies the inclusive 14-day cutoff to availability %s', async (availableDate, ready) => {
    availability.mockResolvedValue([
      { termYears: 2, availableDate },
      { termYears: 10, availableDate },
    ]);
    expect(await governmentYieldCurveReady([dependency], '20260807')).toBe(ready);
  });

  it('admits a deployment without yield dependencies without reading market data', async () => {
    expect(
      await governmentYieldCurveReady(
        [{ ...dependency, inputs: ['etf.adjustedClose'] }],
        '20260807',
      ),
    ).toBe(true);
    expect(availability).not.toHaveBeenCalled();
  });

  it('requires every frozen maturity and propagates query failures', async () => {
    availability.mockResolvedValue([{ termYears: 2, availableDate: '20260807' }]);
    expect(await governmentYieldCurveReady([dependency], '20260807')).toBe(false);
    availability.mockRejectedValue(new Error('Market query failed'));
    await expect(governmentYieldCurveReady([dependency], '20260807')).rejects.toThrow(
      'Market query failed',
    );
  });
});
