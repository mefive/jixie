import { describe, expect, it } from 'vitest';
import {
  analyzeCalendarCoverage,
  findSharpRowCountDrops,
  selectEvaluationDates,
  summarizeMacroPit,
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

  it('audits macro availability evidence and vintage disclosure', () => {
    const result = summarizeMacroPit(
      ['cn_pmi_manufacturing', 'cn_cpi_yoy'],
      [
        {
          seriesKey: 'cn_pmi_manufacturing',
          releaseDate: '20260201',
          availableDate: '20260202',
          availabilityKind: 'official_schedule',
          vintageKind: 'captured_as_available',
        },
        {
          seriesKey: 'cn_cpi_yoy',
          releaseDate: null,
          availableDate: '20260221',
          availabilityKind: 'conservative_lag',
          vintageKind: 'latest_value_backfill',
        },
        {
          seriesKey: 'cn_cpi_yoy',
          releaseDate: '20260310',
          availableDate: '20260309',
          availabilityKind: 'official_schedule',
          vintageKind: 'captured_as_available',
        },
      ],
      new Set(['20260202', '20260309']),
    );

    expect(result).toEqual({
      missingSeries: ['cn_ppi_yoy'],
      invalidAvailabilityRows: 1,
      nonTradingAvailabilityRows: 1,
      conservativeLagRows: 1,
      latestValueBackfillRows: 1,
      capturedAsAvailableRows: 2,
    });
  });
});
