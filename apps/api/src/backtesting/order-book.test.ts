import { describe, expect, it, vi } from 'vitest';
import { AllocationAnalysisTracker } from './allocation-analysis-tracker.js';
import { EngineData } from './data/engine-data.js';
import { fixturePort } from './testing/fixture-port.js';
import { CashPortfolio } from './cash-portfolio.js';
import { DEFAULT_COST } from './cost.js';
import { OrderBook } from './order-book.js';

describe('OrderBook decision ownership', () => {
  it('detaches snapshots and retains conditional orders across empty decisions until canceled', () => {
    const engineData = new EngineData({
      start: '20240102',
      end: '20240104',
      dataPort: fixturePort({
        stockPriceLimits: { up: 1000000, down: 0.0001 },
        dates: [],
        stocks: [],
      }),
    });
    const orders = new OrderBook({
      engineData,
      cashPortfolio: new CashPortfolio(10000, DEFAULT_COST),
      allocationTracker: new AllocationAnalysisTracker(10000, new Map()),
      onRebalance: () => {},
      cost: DEFAULT_COST,
    });
    orders.beginDecision('20240102');
    orders.orderStockLots('A', 2);
    orders.setStockLimitBuyAtAdjustedPrice('A', 10, 100);
    orders.commitDecision();
    const snapshot = orders.snapshotCashOrders();
    snapshot.pendingLotOrders!.set('A', 999);
    const limit = snapshot.conditionalOrders.get('limit_buy:A')!;
    if (limit.kind !== 'limit_buy') {
      throw new Error('Expected limit buy');
    }
    limit.triggerPrice = 999;
    expect(orders.snapshotCashOrders().pendingLotOrders!.get('A')).toBe(2);
    expect(orders.snapshotCashOrders().conditionalOrders.get('limit_buy:A')).toMatchObject({
      triggerPrice: 10,
    });

    orders.beginDecision('20240103');
    orders.commitDecision();
    expect(orders.snapshotCashOrders().pendingLotOrders).toBeNull();
    expect(orders.snapshotCashOrders().conditionalOrders.size).toBe(1);
    orders.beginDecision('20240104');
    orders.cancelStockConditional('A', 'limit_buy');
    orders.commitDecision();
    expect(orders.snapshotCashOrders().conditionalOrders.size).toBe(0);
  });
});

async function executionFixture(onRebalance: (date: string) => void = () => {}) {
  const dates = ['20240102', '20240103', '20240104'];
  const cost = { ...DEFAULT_COST, slippageBps: 0, impactCoef: 0 };
  const engineData = new EngineData({
    start: dates[0],
    end: dates.at(-1)!,
    dataPort: fixturePort({
      stockPriceLimits: { up: 1000000, down: 0.0001 },
      dates,
      stocks: ['A', 'B'].map((code) => ({
        code,
        bars: dates.map((date) => ({ date, open: 10, close: 10 })),
      })),
    }),
  });
  await engineData.load();

  const cashPortfolio = new CashPortfolio(10000, cost);
  const allocationTracker = new AllocationAnalysisTracker(10000, new Map());
  const orders = new OrderBook({
    engineData,
    cashPortfolio,
    allocationTracker,
    cost,
    onRebalance,
  });

  return { engineData, cashPortfolio, allocationTracker, orders };
}

describe('OrderBook execution boundaries', () => {
  it('keeps a stock order unfilled when exact execution-date limits are missing', async () => {
    const { engineData, orders, cashPortfolio } = await executionFixture();
    vi.spyOn(engineData, 'priceLimitsOn').mockReturnValue(null);
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('A', 100);
    orders.commitDecision();

    await orders.executeOrders('20240103');

    expect(cashPortfolio.positions.size).toBe(0);
    expect(cashPortfolio.cash).toBe(10000);
  });

  it('distinguishes no rebalance from an explicit empty target and records the original dates', async () => {
    const notifications: string[] = [];
    const { orders, cashPortfolio, allocationTracker } = await executionFixture((date) =>
      notifications.push(date),
    );
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('A', 100);
    orders.commitDecision();
    await orders.executeOrders('20240103');
    expect(cashPortfolio.positions.get('A')?.shares).toBe(100);
    expect(notifications).toEqual([]);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toEqual([]);

    orders.beginDecision('20240103');
    orders.setStockTargetWeights(new Map());
    orders.commitDecision();
    expect(orders.snapshotCashOrders().pendingTargets).toEqual(new Map());
    await orders.executeOrders('20240104');

    expect(cashPortfolio.positions.size).toBe(0);
    expect(orders.snapshotCashOrders().pendingTargets).toBeNull();
    expect(notifications).toEqual(['20240104']);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toMatchObject([
      { decisionDate: '20240103', executionDate: '20240104', postTradeDistance: 0 },
    ]);
  });

  it('consumes cash orders before a conditional load failure and never retries their fills', async () => {
    const { orders, engineData, cashPortfolio } = await executionFixture();
    const loadBars = engineData.loadBars.bind(engineData);
    vi.spyOn(engineData, 'loadBars').mockImplementation(async (codes) => {
      if (codes.includes('B')) {
        throw new Error('conditional bars unavailable');
      }
      await loadBars(codes);
    });
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('A', 100);
    orders.orderStockLots('A', 1);
    orders.setStockLimitBuyAtAdjustedPrice('B', 5, 100);
    orders.commitDecision();

    await expect(orders.executeOrders('20240103')).rejects.toThrow('conditional bars unavailable');
    expect(cashPortfolio.positions.get('A')?.shares).toBe(200);
    expect(orders.snapshotCashOrders().pendingOrders).toBeNull();
    expect(orders.snapshotCashOrders().pendingLotOrders).toBeNull();
    expect(orders.snapshotCashOrders().conditionalOrders.size).toBe(1);

    await expect(orders.executeOrders('20240104')).rejects.toThrow('conditional bars unavailable');
    expect(cashPortfolio.trades).toHaveLength(1);
  });

  it('consumes unfilled ordinary orders while preserving persistent limit buys', async () => {
    const { orders, cashPortfolio } = await executionFixture();
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('MISSING', 100);
    orders.orderStockLots('MISSING', 1);
    orders.setStockLimitBuyAtAdjustedPrice('MISSING', 10, 100);
    orders.commitDecision();

    await orders.executeOrders('20240103');

    expect(cashPortfolio.trades).toEqual([]);
    expect(orders.snapshotCashOrders().pendingOrders).toBeNull();
    expect(orders.snapshotCashOrders().pendingLotOrders).toBeNull();
    expect(orders.snapshotCashOrders().conditionalOrders.get('limit_buy:MISSING')).toMatchObject({
      placedDate: '20240102',
      triggerPrice: 10,
      shares: 100,
    });
  });
});

describe('account-scoped decision semantics', () => {
  it.each(['target-first', 'delta-first'] as const)(
    'rejects stock target/delta mixtures in either order: %s',
    async (sequence) => {
      const { orders } = await executionFixture();
      orders.beginDecision('20240102');
      if (sequence === 'target-first') {
        orders.setStockTargetWeights({ A: 0.5 });
        expect(() => orders.orderStockAdjustedShares('B', 100)).toThrow(/不能混用|cannot mix/);
        expect(() => orders.orderStockLots('B', 1)).toThrow(/不能混用|cannot mix/);
      } else {
        orders.orderStockLots('A', 1);
        expect(() => orders.setStockTargetWeight('B', 0.5)).toThrow(/不能混用|cannot mix/);
        expect(() => orders.setStockTargetWeights({ B: 0.5 })).toThrow(/不能混用|cannot mix/);
      }
    },
  );

  it('accumulates cash deltas without changing the committed order snapshot', async () => {
    const { orders } = await executionFixture();
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('A', 100);
    orders.orderStockAdjustedShares('A', -20);
    orders.commitDecision();

    expect(orders.snapshotCashOrders().pendingOrders).toEqual(new Map([['A', 80]]));
  });

  it('closes a stock position once and cancels preceding buys in both units', async () => {
    const { orders, cashPortfolio } = await executionFixture();
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('A', 100);
    orders.commitDecision();
    await orders.executeOrders('20240103');

    orders.beginDecision('20240103');
    orders.orderStockAdjustedShares('A', 300);
    orders.orderStockLots('A', 2);
    orders.closeStockPosition('A');
    orders.closeStockPosition('A');
    expect(() => orders.orderStockAdjustedShares('A', 1)).toThrow(/不能混用|cannot mix/);
    orders.commitDecision();
    expect(orders.snapshotCashOrders().pendingOrders?.get('A')).toBe(-100);
    expect(orders.snapshotCashOrders().pendingLotOrders?.has('A')).toBe(false);
    await orders.executeOrders('20240104');

    expect(cashPortfolio.positions.has('A')).toBe(false);
    expect(cashPortfolio.trades.map((trade) => trade.side)).toEqual(['buy', 'sell']);
  });

  it('cancels a buy without a position and leaves persistent conditions independent', async () => {
    const { orders } = await executionFixture();
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('A', 100);
    orders.setStockLimitBuyAtAdjustedPrice('A', 5, 100);
    orders.closeStockPosition('A');
    orders.commitDecision();

    expect(orders.snapshotCashOrders().pendingOrders?.has('A')).toBe(false);
    expect(orders.snapshotCashOrders().conditionalOrders.has('limit_buy:A')).toBe(true);
  });

  it('allows later targets to replace closes and later closes to override targets', async () => {
    const { orders } = await executionFixture();
    orders.beginDecision('20240102');
    orders.setStockTargetWeights({ A: 0.5, B: 0.5 });
    orders.closeStockPosition('A');
    orders.commitDecision();
    expect(orders.snapshotCashOrders().pendingTargets).toEqual(
      new Map([
        ['A', 0],
        ['B', 0.5],
      ]),
    );

    orders.beginDecision('20240103');
    orders.closeStockPosition('A');
    orders.setStockTargetWeight('A', 0.3);
    orders.commitDecision();

    expect(orders.snapshotCashOrders().pendingTargets?.get('A')).toBe(0.3);
  });
});
