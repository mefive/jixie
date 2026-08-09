import { describe, expect, it } from 'vitest';
import {
  AllocationAnalysisTracker,
  allocationAssetClasses,
  classifyAllocationRateRegime,
  type AllocationRateRegimeObservation,
} from './allocation-analysis.js';
import type { CustomFactorModule } from './custom-factor.js';
import type { Position, TradeRecord } from './types.js';

describe('allocation analysis', () => {
  it('reconciles daily asset contribution, costs and portfolio P&L', () => {
    const tracker = new AllocationAnalysisTracker(
      1_000,
      new Map([
        ['EQUITY', 'cn_equity'],
        ['BOND', 'fixed_income'],
      ]),
    );
    const empty = new Map<string, Position>();
    tracker.captureDay({
      date: '20240101',
      value: 1_000,
      positions: empty,
      closeOf: () => 10,
      exactCloseOf: () => 10,
      trades: [],
    });

    const target = new Map([['EQUITY', 0.5]]);
    const preTrade = tracker.weights(1_000, empty, () => 10);
    const positions = new Map<string, Position>([
      ['EQUITY', { shares: 50, avgCost: 10.12, frozenUntil: '20240103' }],
    ]);
    const buy: TradeRecord = {
      date: '20240102',
      code: 'EQUITY',
      side: 'buy',
      shares: 50,
      price: 10.1,
      amount: 505,
      fee: 1,
      slippageCost: 5,
      realShares: 50,
      realPrice: 10.1,
      assetType: 'etf',
    };
    const postTrade = tracker.weights(494, positions, () => 10);
    tracker.captureRebalance({
      decisionDate: '20240101',
      executionDate: '20240102',
      targets: target,
      preTrade,
      postTrade,
    });
    tracker.captureDay({
      date: '20240102',
      value: 994,
      positions,
      closeOf: () => 10,
      exactCloseOf: () => 10,
      trades: [buy],
    });
    tracker.captureDay({
      date: '20240103',
      value: 1_094,
      positions,
      closeOf: () => 12,
      exactCloseOf: () => 12,
      trades: [],
    });

    const result = tracker.finish(1_094);
    expect(result.reconciliation.portfolioPnl).toBe(94);
    expect(result.reconciliation.attributedNetPnl).toBeCloseTo(94, 10);
    expect(result.reconciliation.residual).toBeCloseTo(0, 10);
    expect(result.reconciliation.reconciled).toBe(true);
    expect(result.costs).toEqual({ fees: 1, slippage: 5, total: 6 });
    const equity = result.assets.find((row) => row.assetId === 'EQUITY')!;
    expect(equity.assetClass).toBe('cn_equity');
    expect(equity.grossPnl).toBeCloseTo(100, 10);
    expect(equity.costs).toBe(6);
    expect(equity.netPnl).toBeCloseTo(94, 10);
    expect(equity.returnContribution).toBeCloseTo(0.094, 10);
    expect(equity.riskContribution).toBeCloseTo(1, 10);
    expect(result.assets.find((row) => row.assetId === 'BOND')).toMatchObject({
      assetClass: 'fixed_income',
      netPnl: 0,
    });
    expect(result.drift[0]).toMatchObject({
      decisionDate: '20240101',
      executionDate: '20240102',
      preTradeDistance: 0.5,
    });
    expect(result.drift[0].postTradeDistance).toBeCloseTo(0.003018, 5);
  });

  it('computes class correlations from exact consecutive market returns with coverage gates', () => {
    const tracker = new AllocationAnalysisTracker(
      1_000,
      new Map([
        ['EQUITY', 'cn_equity'],
        ['BOND', 'fixed_income'],
        ['GOLD', 'gold'],
      ]),
    );
    const dates = tradingDates(130);
    let equity = 100;
    let bond = 100;
    let gold = 100;
    for (let index = 0; index < dates.length; index++) {
      if (index > 0) {
        const equityReturn = index % 2 === 0 ? 0.01 : -0.01;
        equity *= 1 + equityReturn;
        bond *= 1 - equityReturn;
        gold *= 1 - equityReturn;
      }
      const prices: Record<string, number | null> = {
        EQUITY: equity,
        BOND: index % 3 === 0 ? null : bond,
        GOLD: gold,
      };
      tracker.captureDay({
        date: dates[index],
        value: 1_000,
        positions: new Map(),
        closeOf: (assetId) => prices[assetId],
        exactCloseOf: (assetId) => prices[assetId],
        trades: [],
      });
    }

    const correlations = tracker.finish(1_000).correlations!;
    expect(correlations).toMatchObject({
      methodology: 'equal_weight_asset_class_returns',
      sampling: 'month_end',
      minimumCoverage: 2 / 3,
    });
    const sixty = correlations.windows.find((row) => row.window === 60)!;
    const equityIndex = sixty.assetClasses.indexOf('cn_equity');
    const bondIndex = sixty.assetClasses.indexOf('fixed_income');
    const goldIndex = sixty.assetClasses.indexOf('gold');
    expect(sixty.minimumObservations).toBe(40);
    expect(sixty.latest[equityIndex][goldIndex]).toBeCloseTo(-1, 10);
    expect(sixty.latestObservations[equityIndex][goldIndex]).toBe(60);
    expect(sixty.latest[equityIndex][bondIndex]).toBeNull();
    expect(sixty.latestObservations[equityIndex][bondIndex]).toBeLessThan(40);
    const equityGold = sixty.series.find(
      (row) => row.left === 'cn_equity' && row.right === 'gold',
    )!;
    expect(equityGold.points.length).toBeGreaterThan(0);
    expect(equityGold.points.at(-1)?.value).toBeCloseTo(-1, 10);
  });

  it('groups asset-class returns by point-in-time rate environment', () => {
    const tracker = new AllocationAnalysisTracker(
      1_000,
      new Map([
        ['EQUITY', 'cn_equity'],
        ['BOND', 'fixed_income'],
      ]),
    );
    const dates = tradingDates(6);
    const equityPrices = [100, 101, 99, 100, 102, 101];
    const bondPrices = [100, 100.5, 101, 100.8, 101.2, 102];
    for (let index = 0; index < dates.length; index++) {
      const prices = { EQUITY: equityPrices[index], BOND: bondPrices[index] };
      const state = index < 3 ? 'rates_rising_curve_steep' : 'rates_falling_curve_flat';
      tracker.captureDay({
        date: dates[index],
        value: 1_000,
        positions: new Map(),
        closeOf: (assetId) => prices[assetId as keyof typeof prices],
        exactCloseOf: (assetId) => prices[assetId as keyof typeof prices],
        trades: [],
        rateRegime: rateObservation(dates[index], state),
      });
    }

    const analysis = tracker.finish(1_000).rateRegimes!;
    expect(analysis).toMatchObject({
      methodology: 'cgb_10y_direction_and_10y_2y_relative_slope',
      pointInTime: 'available_date',
      classifiedDays: 6,
      totalDays: 6,
      latest: { state: 'rates_falling_curve_flat' },
    });
    const rising = analysis.states.find((state) => state.key === 'rates_rising_curve_steep')!;
    expect(rising).toMatchObject({ observations: 3, episodes: 1, averageDuration: 3 });
    expect(rising.assetClasses.find((row) => row.assetClass === 'cn_equity')).toMatchObject({
      observations: 2,
      positiveDayRate: 0.5,
    });
    const falling = analysis.states.find((state) => state.key === 'rates_falling_curve_flat')!;
    expect(falling).toMatchObject({ observations: 3, episodes: 1, averageDuration: 3 });
    expect(
      falling.assetClasses.find((row) => row.assetClass === 'fixed_income')!.annualizedMeanReturn,
    ).toBeGreaterThan(0);
  });

  it('classifies the rate environment without reading unavailable or stale curve points', () => {
    const dates = tradingDates(252);
    const tenYear = dates.map((availableDate, index) => ({
      availableDate,
      yieldPct: 2 + index * 0.001,
    }));
    const twoYear = dates.map((availableDate, index) => ({
      availableDate,
      yieldPct: 1.5 + index * 0.0005,
    }));

    const observation = classifyAllocationRateRegime(dates.at(-1)!, tenYear, twoYear);
    expect(observation).toMatchObject({ state: 'rates_rising_curve_steep' });
    expect(observation?.tenYearChangeBp).toBeCloseTo(6, 10);
    expect(observation?.curveSlopeBp).toBeGreaterThan(observation?.curveMedianBp ?? Infinity);
    expect(classifyAllocationRateRegime('20260201', tenYear, twoYear)).toBeNull();
    expect(classifyAllocationRateRegime(dates[118], tenYear.slice(0, 119), twoYear)).toBeNull();
  });

  it('takes the approved panel universe as the authoritative asset taxonomy', () => {
    const modules: CustomFactorModule[] = [
      {
        key: 'allocation_panel',
        analysisKind: 'panel',
        panelComposite: {
          standardization: 'rank',
          assetUniverse: [
            { assetId: 'EQUITY', assetClass: 'cn_equity' },
            { assetId: 'BOND', assetClass: 'fixed_income' },
          ],
          components: [],
        },
      },
    ];
    expect([...allocationAssetClasses(modules)]).toEqual([
      ['EQUITY', 'cn_equity'],
      ['BOND', 'fixed_income'],
    ]);
  });

  it('rejects conflicting asset classes instead of silently misclassifying exposure', () => {
    const modules: CustomFactorModule[] = [
      panelModule('first', 'cn_equity'),
      panelModule('second', 'fixed_income'),
    ];
    expect(() => allocationAssetClasses(modules)).toThrow('conflicting asset classes for ETF');
  });
});

function panelModule(key: string, assetClass: 'cn_equity' | 'fixed_income'): CustomFactorModule {
  return {
    key,
    analysisKind: 'panel',
    panelComposite: {
      standardization: 'rank',
      assetUniverse: [{ assetId: 'ETF', assetClass }],
      components: [],
    },
  };
}

function tradingDates(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(2024, 0, 1));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10).replaceAll('-', ''));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function rateObservation(
  asOfDate: string,
  state: AllocationRateRegimeObservation['state'],
): AllocationRateRegimeObservation {
  return {
    asOfDate,
    state,
    tenYearYieldPct: 2,
    tenYearChangeBp: state.startsWith('rates_rising') ? 5 : -5,
    curveSlopeBp: state.endsWith('curve_steep') ? 60 : 20,
    curveMedianBp: 40,
  };
}
