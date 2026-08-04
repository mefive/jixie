import { describe, expect, it } from 'vitest';
import type { IndustryIndicatorRow, MarketIndicatorRow, SwIndexDailyRow } from './market-state.js';
import {
  buildIndustryWeatherSeries,
  buildIndexWeatherSeries,
  buildIndexTrailingReturns,
  buildMarketStylePairs,
  buildMarketStateSnapshot,
} from './market-state.js';

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
      {
        value: 'all' as const,
        startDate: '20150101',
        endDate: '20260120',
        return5Day: 0.005,
        return20Day: 0.01,
        return60Day: 0.03,
        breadth: 0.5,
      },
      {
        value: '000300.SH' as const,
        startDate: '20160129',
        endDate: '20260120',
        return5Day: 0.01,
        return20Day: 0.02,
        return60Day: 0.04,
        breadth: 0.6,
      },
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

  it('calculates index returns over three trading-day windows', () => {
    const rows = Array.from({ length: 61 }, (_, index) => ({
      tsCode: '000300.SH',
      tradeDate: `2026${String(index + 1).padStart(4, '0')}`,
      close: 100 + index,
    }));

    const result = buildIndexTrailingReturns(rows).get('000300.SH');

    expect(result?.return5Day).toBeCloseTo(160 / 155 - 1);
    expect(result?.return20Day).toBeCloseTo(160 / 140 - 1);
    expect(result?.return60Day).toBeCloseTo(0.6);
  });

  it('reports weekly and monthly industry rank changes with positive values for climbers', () => {
    const marketRows: MarketIndicatorRow[] = Array.from({ length: 21 }, (_, index) => ({
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
    const industryRows = marketRows.flatMap((marketRow, index) => {
      const hasClimbed = index === marketRows.length - 1;
      return [
        industryRow(
          '801080.SI',
          '电子',
          marketRow.tradeDate,
          hasClimbed ? 3 : 1,
          hasClimbed ? 0.1 : -0.1,
          hasClimbed ? 0.8 : 0.2,
        ),
        industryRow(
          '801780.SI',
          '银行',
          marketRow.tradeDate,
          hasClimbed ? 1 : 3,
          hasClimbed ? -0.1 : 0.1,
          hasClimbed ? 0.2 : 0.8,
        ),
      ];
    });

    const result = buildMarketStateSnapshot(marketRows, industryRows);
    const electronics = result?.industries.find((industry) => industry.l1Code === '801080.SI');

    expect(electronics?.rank).toBe(1);
    expect(electronics?.rankChange5Day).toBe(1);
    expect(electronics?.rankChange20Day).toBe(1);
  });

  it('only builds style pairs when both legs carry the official style-index classification', () => {
    const closeRows = ['000918.CSI', '000919.CSI'].flatMap((tsCode, codeIndex) =>
      Array.from({ length: 61 }, (_, index) => ({
        tsCode,
        tradeDate: `2026${String(index + 1).padStart(4, '0')}`,
        close: 100 + index * (codeIndex === 0 ? 2 : 1),
      })),
    );
    const result = buildMarketStylePairs(closeRows, [
      {
        tsCode: '000918.CSI',
        name: '300成长',
        bmkSource: '中证指数',
        indexType: '风格类指数',
      },
      {
        tsCode: '000919.CSI',
        name: '300价值',
        bmkSource: '中证指数',
        indexType: '风格类指数',
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('csi300');
    expect(result[0].growth.name).toBe('300成长');
    expect(result[0].spread20Day).toBeGreaterThan(0);
  });

  it('uses official SW index returns and own-history valuation percentiles for industries', () => {
    const dates = Array.from(
      { length: 61 },
      (_, index) => `2026${String(index + 1).padStart(4, '0')}`,
    );
    const marketRows = dates.map(
      (tradeDate): MarketIndicatorRow => ({
        tradeDate,
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
      }),
    );
    const industryRows = [
      industryRow('801080.SI', '电子', dates.at(-1)!, 2, -0.2, 0.7),
      industryRow('801780.SI', '银行', dates.at(-1)!, 1, 0.2, 0.3),
    ];
    const swIndexRows = ['801080.SI', '801780.SI'].flatMap((tsCode, codeIndex) =>
      dates.map((tradeDate, index) => ({
        tsCode,
        tradeDate,
        close: 100 + index * (codeIndex === 0 ? 2 : 0.5),
        pe: 10 + index + codeIndex * 100,
        pb: 1 + index / 10 + codeIndex * 10,
      })),
    );

    const result = buildMarketStateSnapshot(marketRows, industryRows, { swIndexRows });
    const electronics = result?.industries.find((industry) => industry.l1Code === '801080.SI');

    expect(electronics?.officialReturn20Day).toBeGreaterThan(0);
    expect(electronics?.trendScore).toBe(100);
    expect(electronics?.pe).toBe(70);
    expect(electronics?.pePercentile10Year).toBe(1);
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
      [],
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
