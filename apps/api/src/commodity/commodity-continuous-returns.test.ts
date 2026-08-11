import { describe, expect, it } from 'vitest';
import {
  buildCommodityContinuousReturns,
  type CommodityContinuousSettlementBar,
  type CommodityMainContractMapping,
} from './commodity-continuous-returns.js';

describe('commodity continuous returns', () => {
  it('uses the same contract on both endpoints when the mapping is unchanged', () => {
    const points = buildCommodityContinuousReturns(
      [mapping('20260701', 'AU2610.SHF'), mapping('20260702', 'AU2610.SHF')],
      [bar('AU2610.SHF', '20260701', 800), bar('AU2610.SHF', '20260702', 808)],
      ['20260702', '20260703'],
    );

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      tradeDate: '20260702',
      availableDate: '20260703',
      mappedContract: 'AU2610.SHF',
      previousMappedContract: 'AU2610.SHF',
      mappingChanged: false,
      rollGapLogReturn: 0,
      rollYieldProxy: -0,
    });
    expect(points[0]!.continuousReturn).toBeCloseTo(0.01, 12);
    expect(points[0]!.continuousLogReturn).toBeCloseTo(Math.log(808 / 800), 12);
    expect(points[0]!.mappedLogReturn).toBeCloseTo(Math.log(808 / 800), 12);
  });

  it('decomposes a mapped-code jump from the new-contract continuous return', () => {
    const points = buildCommodityContinuousReturns(
      [mapping('20260701', 'AU2608.SHF'), mapping('20260702', 'AU2610.SHF')],
      [
        bar('AU2608.SHF', '20260701', 800),
        bar('AU2610.SHF', '20260701', 810),
        bar('AU2610.SHF', '20260702', 818.1),
      ],
      ['20260702', '20260703'],
    );

    expect(points).toHaveLength(1);
    const point = points[0]!;
    expect(point).toMatchObject({
      previousMappedContract: 'AU2608.SHF',
      mappedContract: 'AU2610.SHF',
      previousMappedSettlement: 800,
      sameContractPreviousSettlement: 810,
      settlement: 818.1,
      mappingChanged: true,
    });
    expect(point.continuousReturn).toBeCloseTo(0.01, 12);
    expect(point.rollGapLogReturn).toBeCloseTo(Math.log(810 / 800), 12);
    expect(point.rollYieldProxy).toBeCloseTo(Math.log(800 / 810), 12);
    expect(point.mappedLogReturn).toBeCloseTo(
      point.continuousLogReturn + point.rollGapLogReturn,
      12,
    );
  });

  it('keeps source gaps missing instead of manufacturing a zero return', () => {
    const points = buildCommodityContinuousReturns(
      [mapping('20260701', 'AU2608.SHF'), mapping('20260702', 'AU2610.SHF')],
      [bar('AU2608.SHF', '20260701', 800), bar('AU2610.SHF', '20260702', 818.1)],
      ['20260703'],
    );

    expect(points).toEqual([]);
  });

  it('fails closed on a mismatched product/mapping identity and missing PIT calendar', () => {
    expect(() =>
      buildCommodityContinuousReturns([mapping('20260701', 'CU2608.SHF')], [], ['20260702']),
    ).toThrow(/Invalid commodity main mapping/);

    expect(() =>
      buildCommodityContinuousReturns(
        [mapping('20260701', 'AU2608.SHF'), mapping('20260702', 'AU2608.SHF')],
        [bar('AU2608.SHF', '20260701', 800), bar('AU2608.SHF', '20260702', 801)],
        ['20260702'],
      ),
    ).toThrow(/No next SSE trading day/);
  });
});

function mapping(tradeDate: string, mappedContract: string): CommodityMainContractMapping {
  return {
    productCode: 'AU',
    continuousCode: 'AU.SHF',
    tradeDate,
    mappedContract,
  };
}

function bar(tsCode: string, tradeDate: string, settle: number): CommodityContinuousSettlementBar {
  return { tsCode, tradeDate, settle };
}
