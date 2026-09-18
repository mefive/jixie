import { describe, expect, it } from 'vitest';
import { analyzeCalendarCoverage, findSharpRowCountDrops } from './coverage.js';

describe('market data audit', () => {
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
});
