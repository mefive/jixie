import { describe, expect, it } from 'vitest';
import { buildCommodityContinuousReturns } from './commodity-continuous-returns.js';

describe('commodity continuous-return audit identity', () => {
  it('keeps mapped return equal to continuous movement plus the removed roll gap', () => {
    const [point] = buildCommodityContinuousReturns(
      [
        {
          productCode: 'CU',
          continuousCode: 'CU.SHF',
          tradeDate: '20260701',
          mappedContract: 'CU2608.SHF',
        },
        {
          productCode: 'CU',
          continuousCode: 'CU.SHF',
          tradeDate: '20260702',
          mappedContract: 'CU2609.SHF',
        },
      ],
      [
        { tsCode: 'CU2608.SHF', tradeDate: '20260701', settle: 80_000 },
        { tsCode: 'CU2609.SHF', tradeDate: '20260701', settle: 80_300 },
        { tsCode: 'CU2609.SHF', tradeDate: '20260702', settle: 80_100 },
      ],
      ['20260703'],
    );

    expect(point!.mappedLogReturn).toBeCloseTo(
      point!.continuousLogReturn + point!.rollGapLogReturn,
      12,
    );
    expect(point!.rollYieldProxy).toBeCloseTo(-point!.rollGapLogReturn, 12);
  });
});
