import { describe, expect, it } from 'vitest';
import { selectEvaluationDates, summarizeWindowCoverage } from './audit.js';

describe('market data audit', () => {
  it('selects evaluation dates across the full history', () => {
    const dates = [
      '20200131',
      '20201231',
      '20211231',
      '20221230',
      '20231229',
      '20241231',
      '20250725',
    ];

    expect(selectEvaluationDates(dates, 3)).toEqual(['20201231', '20231229', '20250725']);
    expect(selectEvaluationDates(dates, 1)).toEqual(['20250725']);
  });
  it('summarizes effective observations against trading days', () => {
    const result = summarizeWindowCoverage('20261231', '20261001', 60, [
      { tsCode: '000001.SZ', observedDays: 60 },
      { tsCode: '000002.SZ', observedDays: 45 },
      { tsCode: '000003.SZ', observedDays: 30 },
    ]);

    expect(result.eligibleStocks).toBe(3);
    expect(result.medianCoverage).toBe(0.75);
    expect(result.tenthPercentileCoverage).toBeCloseTo(0.55);
    expect(result.belowMinimumCount).toBe(1);
  });
});
