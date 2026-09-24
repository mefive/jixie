import { describe, expect, it } from 'vitest';
import type { IndustryIndicatorRow, MarketIndicatorRow, SwIndexDailyRow } from './compute.js';
import {
  buildIndexWeatherSeries,
  buildIndustryWeatherSeries,
  buildMarketStatePoints,
} from './compute.js';

describe('market points and weather', () => {
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

    const points = buildMarketStatePoints(marketRows);
    const latest = points.at(-1)!;

    expect(points).toHaveLength(20);
    expect(points[18].activity).toBeNull();
    expect(latest.activity).toBeCloseTo(10.5);
    expect(latest.breadth).toBeCloseTo(0.35);
    expect(latest.trend).toBeCloseTo(0.029);
    expect(latest.crowding).toBe(0.5);
  });

  it('builds replayable calendar periods from official SW industry closes', () => {
    const dates = ['20260130', '20260227', '20260331'];
    const industryRows = dates.flatMap((tradeDate, index) => [
      industryRow('801080.SI', '电子', tradeDate, index + 1, 0.1, 0.8),
      industryRow('801780.SI', '银行', tradeDate, 1, -0.1, 0.2),
    ]);
    const swIndexRows: SwIndexDailyRow[] = dates.flatMap((tradeDate, index) => [
      {
        tsCode: '801080.SI',
        tradeDate,
        close: [100, 120, 150][index],
        pe: [30, 25, 20][index],
        pb: [3, 2.5, 2][index],
      },
      {
        tsCode: '801780.SI',
        tradeDate,
        close: [100, 90, 80][index],
        pe: [8, 9, 10][index],
        pb: [0.8, 0.9, 1][index],
      },
    ]);

    const monthly = buildIndustryWeatherSeries(industryRows, swIndexRows, 'month');
    const quarterly = buildIndustryWeatherSeries(industryRows, swIndexRows, 'quarter');
    const februaryElectronics = monthly?.periods[1].industries.find(
      (industry) => industry.l1Code === '801080.SI',
    );
    const februaryBank = monthly?.periods[1].industries.find(
      (industry) => industry.l1Code === '801780.SI',
    );

    expect(monthly?.periods.map((period) => period.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(quarterly?.periods).toHaveLength(1);
    expect(monthly?.periods[0].industries.every((industry) => industry.periodReturn == null)).toBe(
      true,
    );
    expect(februaryElectronics?.periodReturn).toBeCloseTo(0.2);
    expect(februaryBank?.periodReturn).toBeCloseTo(-0.1);
    expect(februaryElectronics?.heatScore).toBeGreaterThan(februaryBank?.heatScore ?? 0);
    expect(februaryElectronics?.heatChange).not.toBeNull();
  });

  it('builds fixed grouped cards and exposes partial index metric coverage', () => {
    const groups = [{ key: 'sizeLadder', codes: ['000300.SH', '000905.SH'] }] as const;
    const closeRows = ['20260130', '20260227'].flatMap((tradeDate, index) => [
      { tsCode: '000300.SH', tradeDate, close: [100, 110][index] },
      { tsCode: '000905.SH', tradeDate, close: [100, 95][index] },
    ]);
    const indicatorRows = ['20260130', '20260227'].map((tradeDate, index) => ({
      indexCode: '000300.SH',
      tradeDate,
      return20: 0.02,
      aboveMa20Ratio: 0.6 + index / 10,
      aboveMa60Ratio: 0.5 + index / 10,
      floatWeightedTurnoverRate: 1 + index,
    }));

    const series = buildIndexWeatherSeries(
      'scale',
      groups,
      closeRows,
      indicatorRows,
      ['20260130', '20260227'].map((tradeDate, index) => ({
        tsCode: '000300.SH',
        tradeDate,
        peTtm: 10 + index,
        pb: 1 + index / 10,
        source: 'constituents' as const,
      })),
      [
        { tsCode: '000300.SH', name: '沪深300' },
        { tsCode: '000905.SH', name: '中证500' },
      ],
      'month',
    );
    const latest = series?.periods.at(-1)?.items;

    expect(series?.groups).toEqual([{ key: 'sizeLadder', codes: ['000300.SH', '000905.SH'] }]);
    expect(latest?.map((item) => item.name)).toEqual(['沪深300', '中证500']);
    expect(latest?.[0].coverage).toBe('full');
    expect(latest?.[0].activityScore).not.toBeNull();
    expect(latest?.[1]).toMatchObject({
      coverage: 'partial',
      activityScore: null,
      breadthScore: null,
    });
    expect(latest?.[0].periodReturn).toBeCloseTo(0.1);
    expect(latest?.[1].periodReturn).toBeCloseTo(-0.05);
    expect(latest?.[0].valuationSource).toBe('constituents');
  });

  it('uses factor excess return against its parent benchmark for trend ranking', () => {
    const groups = [{ key: 'coreFactors', codes: ['000984.CSI'] }] as const;
    const closeRows = ['20260130', '20260227'].flatMap((tradeDate, index) => [
      { tsCode: '000984.CSI', tradeDate, close: [100, 112][index] },
      { tsCode: '000300.SH', tradeDate, close: [100, 108][index] },
    ]);
    const indicatorRows = ['20260130', '20260227'].map((tradeDate) => ({
      indexCode: '000984.CSI',
      tradeDate,
      return20: 0.02,
      aboveMa20Ratio: 0.6,
      aboveMa60Ratio: 0.5,
      floatWeightedTurnoverRate: 1,
    }));
    const basicRows = ['20260130', '20260227'].map((tradeDate) => ({
      tsCode: '000984.CSI',
      tradeDate,
      peTtm: 12,
      pb: 1.5,
      source: 'constituents' as const,
    }));

    const series = buildIndexWeatherSeries(
      'style',
      groups,
      closeRows,
      indicatorRows,
      basicRows,
      [
        { tsCode: '000984.CSI', name: '300等权' },
        { tsCode: '000300.SH', name: '沪深300' },
      ],
      'month',
      { '000984.CSI': '000300.SH' },
    );
    const latest = series?.periods.at(-1)?.items[0];

    expect(latest?.periodReturn).toBeCloseTo(0.12);
    expect(latest?.relativeReturn).toBeCloseTo(1.12 / 1.08 - 1);
    expect(latest?.benchmarkName).toBe('沪深300');
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
