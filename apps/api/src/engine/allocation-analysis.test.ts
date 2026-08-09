import { describe, expect, it } from 'vitest';
import { AllocationAnalysisTracker, allocationAssetClasses } from './allocation-analysis.js';
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
    tracker.captureDay({ value: 1_000, positions: empty, closeOf: () => 10, trades: [] });

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
      value: 994,
      positions,
      closeOf: () => 10,
      trades: [buy],
    });
    tracker.captureDay({
      value: 1_094,
      positions,
      closeOf: () => 12,
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
