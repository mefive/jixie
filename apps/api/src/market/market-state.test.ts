import { describe, expect, it } from 'vitest';
import type { IndustryIndicatorRow, MarketIndicatorRow } from './market-state.js';
import { buildMarketStateSnapshot } from './market-state.js';

describe('market state snapshot', () => {
  it('keeps activity, breadth, trend, and crowding independently explainable', () => {
    const marketRows = Array.from(
      { length: 20 },
      (_, index): MarketIndicatorRow => ({
        tradeDate: `202601${String(index + 1).padStart(2, '0')}`,
        tradedCount: 5000,
        return20: 0.01 + index / 1000,
        advanceRatio: 0.5,
        aboveMa20Ratio: 0.3,
        aboveMa60Ratio: 0.4,
        totalAmount: 1_000_000,
        floatWeightedTurnoverRate: index + 1,
        topFivePercentAmountShare: 0.5,
        extremeMoveRatio: 0.1,
        limitUpCount: 30,
        limitDownCount: 5,
      }),
    );

    const result = buildMarketStateSnapshot(marketRows, []);

    expect(result?.latest.activity).toBeCloseTo(10.5);
    expect(result?.latest.breadth).toBeCloseTo(0.35);
    expect(result?.summaries.activity.percentile3Year).toBe(1);
    expect(result?.regime).toBe('hotNarrow');
  });

  it('ranks industry heat from visible trend, breadth, and own-history activity scores', () => {
    const marketRows: MarketIndicatorRow[] = Array.from({ length: 20 }, (_, index) => ({
      tradeDate: `202601${String(index + 1).padStart(2, '0')}`,
      tradedCount: 5000,
      return20: 0,
      advanceRatio: 0.5,
      aboveMa20Ratio: 0.5,
      aboveMa60Ratio: 0.5,
      totalAmount: 1_000_000,
      floatWeightedTurnoverRate: 1,
      topFivePercentAmountShare: 0.4,
      extremeMoveRatio: 0.05,
      limitUpCount: 10,
      limitDownCount: 10,
    }));
    const industryRows: IndustryIndicatorRow[] = [
      industryRow('801080.SI', '电子', '20260119', 1, 0.01, 0.4),
      industryRow('801080.SI', '电子', '20260120', 3, 0.08, 0.8),
      industryRow('801780.SI', '银行', '20260119', 1, -0.01, 0.4),
      industryRow('801780.SI', '银行', '20260120', 1, -0.03, 0.2),
    ];

    const result = buildMarketStateSnapshot(marketRows, industryRows);

    expect(result?.industries[0].l1Name).toBe('电子');
    expect(result?.industries[0].heatScore).toBeGreaterThan(result?.industries[1].heatScore ?? 0);
    expect(result?.industries[0].rank).toBe(1);
  });

  it('preserves index-scope metadata and point-in-time membership coverage', () => {
    const marketRows = Array.from(
      { length: 20 },
      (_, index): MarketIndicatorRow => ({
        tradeDate: `202601${String(index + 1).padStart(2, '0')}`,
        membershipDate: '20251231',
        tradedCount: 300,
        return20: 0.02,
        advanceRatio: 0.6,
        aboveMa20Ratio: 0.7,
        aboveMa60Ratio: 0.5,
        totalAmount: 500_000,
        floatWeightedTurnoverRate: 1.5,
        topFivePercentAmountShare: 0.35,
        extremeMoveRatio: 0.05,
        limitUpCount: 2,
        limitDownCount: 0,
      }),
    );
    const scopeOptions = [
      { value: 'all' as const, startDate: '20150101', endDate: '20260120' },
      { value: '000300.SH' as const, startDate: '20160129', endDate: '20260120' },
    ];

    const result = buildMarketStateSnapshot(marketRows, [], {
      scope: '000300.SH',
      scopeOptions,
    });

    expect(result?.scope).toBe('000300.SH');
    expect(result?.membershipAsOf).toBe('20251231');
    expect(result?.scopeOptions).toEqual(scopeOptions);
    expect(result?.latest.tradedCount).toBe(300);
  });
});

function industryRow(
  l1Code: string,
  l1Name: string,
  tradeDate: string,
  turnover: number,
  excessReturn: number,
  breadth: number,
): IndustryIndicatorRow {
  return {
    l1Code,
    l1Name,
    tradeDate,
    tradedCount: 100,
    return20: excessReturn,
    excessReturn20: excessReturn,
    positiveReturn20Ratio: breadth,
    aboveMa20Ratio: breadth,
    aboveMa60Ratio: breadth,
    floatWeightedTurnoverRate: turnover,
    amountShare: 0.1,
    topFiveAmountShare: 0.3,
  };
}
