import { MARKET_RISK_FACTOR_KEYS_V1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import {
  MARKET_RISK_FACTOR_DEFINITIONS_V1,
  buildMarketRiskDriverHistory,
  type BuildMarketRiskDriverHistoryInput,
  type MarketRiskCurvePoint,
} from './market-risk-drivers.js';

describe('market-risk drivers', () => {
  it('builds nine availability-aligned drivers without filling absent dates', () => {
    const history = buildMarketRiskDriverHistory(input());

    expect(MARKET_RISK_FACTOR_DEFINITIONS_V1.map((definition) => definition.key)).toEqual(
      MARKET_RISK_FACTOR_KEYS_V1,
    );
    const observation = history.observations.find((row) => row.date === '20240103')!;
    for (const [factor, expected] of Object.entries({
      cn_equity: 0.01,
      cgb_level: 10,
      cgb_slope: 5,
      cgb_curvature: 5,
      credit_spread: 5,
      usd_cnh: 0.01,
      us_real_yield: 5,
      gold: 0.02,
      commodity: 0.02,
    })) {
      expect(observation.values[factor as keyof typeof observation.values]).toBeCloseTo(
        expected,
        12,
      );
    }
    expect(history.lineage).toMatchObject({
      dataCutoff: '20240103',
      pointInTimeEligible: true,
      futureVintageRows: 0,
    });
    expect(history.lineage.series).toHaveLength(9);
  });

  it('rejects same-day availability instead of allowing a close-to-close lookahead', () => {
    const value = input();
    value.fxRows[1]!.availableDate = value.fxRows[1]!.tradeDate;

    expect(() => buildMarketRiskDriverHistory(value)).toThrow(/PIT dates/);
  });
});

function input(): BuildMarketRiskDriverHistoryInput {
  const curveRows = [
    ...domesticCurve('20240101', '20240102', [2, 2.3, 2.5]),
    ...domesticCurve('20240102', '20240103', [2.05, 2.4, 2.6]),
    ...creditCurves('20240101', '20240102', [2, 2.5, 2.7]),
    ...creditCurves('20240102', '20240103', [2.1, 2.7, 2.8]),
    curve('us_treasury_real', '20240101', '20240102', 10, 1.8),
    curve('us_treasury_real', '20240102', '20240103', 10, 1.85),
  ];
  return {
    dataCutoff: '20240103',
    openDates: ['20240102', '20240103', '20240104'],
    indexRows: [
      { tradeDate: '20240101', close: 100 },
      { tradeDate: '20240102', close: 101 },
    ],
    curveRows,
    fxRows: [
      {
        tradeDate: '20240101',
        availableDate: '20240102',
        bidClose: 6.99,
        askClose: 7.01,
      },
      {
        tradeDate: '20240102',
        availableDate: '20240103',
        bidClose: 7.06,
        askClose: 7.08,
      },
    ],
    commodityRows: ['AU', 'CU', 'SC', 'M'].flatMap((productCode) => [
      {
        productCode,
        tradeDate: '20240101',
        availableDate: '20240102',
        continuousReturn: 0.01,
      },
      {
        productCode,
        tradeDate: '20240102',
        availableDate: '20240103',
        continuousReturn:
          productCode === 'AU' ? 0.02 : { CU: 0.01, SC: 0.02, M: 0.03 }[productCode]!,
      },
    ]),
  };
}

function domesticCurve(
  tradeDate: string,
  availableDate: string,
  values: [number, number, number],
): MarketRiskCurvePoint[] {
  return [2, 5, 10].map((termYears, index) =>
    curve('mof_cgb_ytm', tradeDate, availableDate, termYears, values[index]!),
  );
}

function creditCurves(
  tradeDate: string,
  availableDate: string,
  values: [number, number, number],
): MarketRiskCurvePoint[] {
  return ['chinabond_cgb_ytm', 'chinabond_bank_aaa_ytm', 'chinabond_cp_note_aaa_ytm'].map(
    (curveCode, index) => curve(curveCode, tradeDate, availableDate, 5, values[index]!),
  );
}

function curve(
  curveCode: string,
  tradeDate: string,
  availableDate: string,
  termYears: number,
  yieldPct: number,
): MarketRiskCurvePoint {
  return { curveCode, tradeDate, availableDate, termYears, yieldPct };
}
