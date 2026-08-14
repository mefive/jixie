import { describe, expect, it } from 'vitest';
import {
  blsYearRanges,
  parseUsHeadlineCpiRows,
  prepareUsHeadlineCpiObservations,
} from './us-headline-cpi.js';

describe('US headline CPI normalization', () => {
  it('chunks public BLS requests into at most ten inclusive calendar years', () => {
    expect(blsYearRanges('200501', '202607')).toEqual([
      { startYear: 2005, endYear: 2014 },
      { startYear: 2015, endYear: 2024 },
      { startYear: 2025, endYear: 2026 },
    ]);
  });

  it('keeps monthly CPI-U index levels and skips annual averages or unavailable values', () => {
    expect(
      parseUsHeadlineCpiRows(
        [
          { year: '2025', period: 'M13', value: '320.000' },
          { year: '2025', period: 'M10', value: '-' },
          { year: '2025', period: 'M09', value: '324.800' },
          { year: '2024', period: 'M12', value: '315.605' },
        ],
        '202501',
        '202512',
      ),
    ).toEqual([{ period: '202509', value: 324.8 }]);
  });

  it('uses month-end plus twenty days and the next available SSE session', () => {
    expect(
      prepareUsHeadlineCpiObservations(
        [
          { period: '202601', value: 325.252 },
          { period: '202602', value: 326.785 },
        ],
        ['20260220', '20260320', '20260323'],
      ),
    ).toEqual([
      {
        seriesKey: 'us_cpi_u_all_items_nsa',
        period: '202601',
        value: 325.252,
        releaseDate: null,
        availableDate: '20260220',
        availabilityKind: 'conservative_lag',
      },
      {
        seriesKey: 'us_cpi_u_all_items_nsa',
        period: '202602',
        value: 326.785,
        releaseDate: null,
        availableDate: '20260320',
        availabilityKind: 'conservative_lag',
      },
    ]);
  });

  it('fails closed on duplicate periods or malformed numeric values', () => {
    expect(() =>
      parseUsHeadlineCpiRows(
        [
          { year: '2025', period: 'M01', value: '317.671' },
          { year: '2025', period: 'M01', value: '317.672' },
        ],
        '202501',
        '202501',
      ),
    ).toThrow('duplicate period 202501');
    expect(() =>
      parseUsHeadlineCpiRows(
        [{ year: '2025', period: 'M01', value: 'not-a-number' }],
        '202501',
        '202501',
      ),
    ).toThrow('invalid value');
  });
});
