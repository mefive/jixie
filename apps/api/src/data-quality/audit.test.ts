import { describe, expect, it } from 'vitest';
import {
  analyzeCalendarCoverage,
  findSharpRowCountDrops,
  selectEvaluationDates,
  summarizeWindowCoverage,
} from './audit.js';

describe('data quality audit helpers', () => {
  it('separates leading, internal, and trailing calendar gaps', () => {
    const result = analyzeCalendarCoverage(
      ['20260102', '20260105', '20260106', '20260107', '20260108'],
      [
        { tradeDate: '20260105', count: 100 },
        { tradeDate: '20260107', count: 110 },
      ],
    );

    expect(result.leadingMissingDates).toEqual(['20260102']);
    expect(result.internalMissingDates).toEqual(['20260106']);
    expect(result.trailingMissingDates).toEqual(['20260108']);
    expect(result.observedStart).toBe('20260105');
    expect(result.observedEnd).toBe('20260107');
  });

  it('detects a sharp row-count drop against the prior rolling median', () => {
    const stable = Array.from({ length: 20 }, (_, index) => ({
      tradeDate: `202601${String(index + 1).padStart(2, '0')}`,
      count: index % 2 === 0 ? 100 : 102,
    }));

    expect(
      findSharpRowCountDrops([
        ...stable,
        { tradeDate: '20260121', count: 60 },
        { tradeDate: '20260122', count: 100 },
      ]),
    ).toEqual([{ tradeDate: '20260121', count: 60, referenceMedian: 101 }]);
  });

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
