import { describe, expect, it } from 'vitest';
import { buildIndexValuationSeries } from './index-valuation.js';

describe('index valuation series', () => {
  it('weights percentile by daily observations and reports ten-year and full-history ranks', () => {
    const result = buildIndexValuationSeries(
      '000300.SH',
      [
        {
          tsCode: '000300.SH',
          tradeDate: '20150105',
          pe: 10,
          peTtm: 10,
          pb: 1,
          turnoverRate: 1,
        },
        {
          tsCode: '000300.SH',
          tradeDate: '20160105',
          pe: 30,
          peTtm: 30,
          pb: 3,
          turnoverRate: 3,
        },
        {
          tsCode: '000300.SH',
          tradeDate: '20260724',
          pe: 20,
          peTtm: 20,
          pb: 2,
          turnoverRate: 2,
        },
      ],
      [
        { tradeDate: '20150105', close: 3000 },
        { tradeDate: '20160105', close: 3100 },
        { tradeDate: '20260724', close: 4000 },
      ],
    );

    expect(result?.tenYearStart).toBe('20160724');
    expect(result?.summaries.pe.percentile10Year).toBe(1);
    expect(result?.summaries.pe.percentileAll).toBeCloseTo(2 / 3);
    expect(result?.points).toHaveLength(3);
  });

  it('drops valuation dates without a matching close', () => {
    const result = buildIndexValuationSeries(
      '000300.SH',
      [
        {
          tsCode: '000300.SH',
          tradeDate: '20260723',
          pe: 10,
          peTtm: 10,
          pb: 1,
          turnoverRate: 1,
        },
        {
          tsCode: '000300.SH',
          tradeDate: '20260724',
          pe: 11,
          peTtm: 11,
          pb: 1.1,
          turnoverRate: 1.1,
        },
      ],
      [{ tradeDate: '20260724', close: 4500 }],
    );

    expect(result?.points.map((point) => point.date)).toEqual(['20260724']);
    expect(result?.asOf).toBe('20260724');
  });
});
