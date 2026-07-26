import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from '@jixie/shared';
import { EngineData } from './data.js';
import { fixturePort } from './fixture-port.js';

describe('index valuation data', () => {
  it('calculates an as-of percentile without reading future observations', async () => {
    const data = new EngineData(
      '20200102',
      '20200106',
      [],
      () => {},
      DEFAULT_LOCALE,
      fixturePort({
        dates: ['20200102', '20200103', '20200106'],
        stocks: [],
        indexDailyBasic: [
          { tsCode: '000300.SH', tradeDate: '20200102', pe: 10, peTtm: 11, pb: 1 },
          { tsCode: '000300.SH', tradeDate: '20200103', pe: 30, peTtm: 31, pb: 3 },
          { tsCode: '000300.SH', tradeDate: '20200106', pe: 20, peTtm: 21, pb: 2 },
        ],
      }),
    );

    await data.load();

    expect(data.indexValuationAsOf('000300.SH', '20200103', 'pe')).toBe(30);
    expect(data.indexValuationPercentile('000300.SH', '20200103', 'pe')).toBe(1);
    expect(data.indexValuationPercentile('000300.SH', '20200106', 'pe')).toBeCloseTo(2 / 3);
    expect(data.indexValuationPercentile('000300.SH', '20200106', 'pe', 2)).toBe(0.5);
    expect(data.indexValuationAsOf('399006.SZ', '20200106', 'pe')).toBeNull();
  });
});
