import { describe, expect, it, vi } from 'vitest';
import { AllocationAnalysisTracker } from './allocation-analysis.js';
import { EngineData } from './data/engine-data.js';
import { fixturePort } from './testing/fixture-port.js';
import { CashPortfolio } from './cash-portfolio.js';
import { FuturesPortfolio } from './futures-portfolio.js';
import { DEFAULT_COST } from './cost.js';
import { OrderBook } from './order-book.js';

describe('OrderBook decision ownership', () => {
  it('detaches snapshots and retains conditional orders across empty decisions until canceled', () => {
    const engineData = new EngineData({
      start: '20240102',
      end: '20240104',
      dataPort: fixturePort({ dates: [], stocks: [] }),
    });
    const orders = new OrderBook({
      engineData,
      cashPortfolio: new CashPortfolio(10000, DEFAULT_COST),
      futuresPortfolio: new FuturesPortfolio(0, DEFAULT_COST),
      allocationTracker: new AllocationAnalysisTracker(10000, new Map()),
      onRebalance: () => {},
      cost: DEFAULT_COST,
    });
    orders.beginDecision('20240102');
    orders.orderLots('A', 2);
    orders.limitBuy('A', 10, 100);
    orders.commitDecision();
    const snapshot = orders.snapshot();
    snapshot.pendingLotOrders!.set('A', 999);
    const limit = snapshot.conditionalOrders.get('limit_buy:A')!;
    if (limit.kind !== 'limit_buy') {
      throw new Error('Expected limit buy');
    }
    limit.triggerPrice = 999;
    expect(orders.snapshot().pendingLotOrders!.get('A')).toBe(2);
    expect(orders.snapshot().conditionalOrders.get('limit_buy:A')).toMatchObject({
      triggerPrice: 10,
    });

    orders.beginDecision('20240103');
    orders.commitDecision();
    expect(orders.snapshot().pendingLotOrders).toBeNull();
    expect(orders.snapshot().conditionalOrders.size).toBe(1);
    orders.beginDecision('20240104');
    orders.cancelConditional('A', 'limit_buy');
    orders.commitDecision();
    expect(orders.snapshot().conditionalOrders.size).toBe(0);
  });
});

async function executionFixture(onRebalance: (date: string) => void = () => {}) {
  const dates = ['20240102', '20240103', '20240104'];
  const cost = { ...DEFAULT_COST, slippageBps: 0, impactCoef: 0 };
  const engineData = new EngineData({
    start: dates[0],
    end: dates.at(-1)!,
    dataPort: fixturePort({
      dates,
      stocks: ['A', 'B'].map((code) => ({
        code,
        bars: dates.map((date) => ({ date, open: 10, close: 10 })),
      })),
    }),
  });
  await engineData.load();

  const cashPortfolio = new CashPortfolio(10000, cost);
  const futuresPortfolio = new FuturesPortfolio(0, cost);
  const allocationTracker = new AllocationAnalysisTracker(10000, new Map());
  const orders = new OrderBook({
    engineData,
    cashPortfolio,
    futuresPortfolio,
    allocationTracker,
    cost,
    onRebalance,
  });

  return { engineData, cashPortfolio, futuresPortfolio, allocationTracker, orders };
}

describe('OrderBook execution boundaries', () => {
  it('distinguishes no rebalance from an explicit empty target and records the original dates', async () => {
    const notifications: string[] = [];
    const { orders, cashPortfolio, allocationTracker } = await executionFixture((date) =>
      notifications.push(date),
    );
    orders.beginDecision('20240102');
    orders.order('A', 100);
    orders.commitDecision();
    await orders.executeOrders('20240103', '20240102');
    expect(cashPortfolio.positions.get('A')?.shares).toBe(100);
    expect(notifications).toEqual([]);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toEqual([]);

    orders.beginDecision('20240103');
    orders.setHoldings(new Map());
    orders.commitDecision();
    expect(orders.snapshot().pendingTargets).toEqual(new Map());
    await orders.executeOrders('20240104', '20240103');

    expect(cashPortfolio.positions.size).toBe(0);
    expect(orders.snapshot().pendingTargets).toBeNull();
    expect(notifications).toEqual(['20240104']);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toMatchObject([
      { decisionDate: '20240103', executionDate: '20240104', postTradeDistance: 0 },
    ]);
  });

  it('retains later orders when their load fails after rebalance attribution and notification', async () => {
    const notifications: string[] = [];
    const { orders, engineData, cashPortfolio, allocationTracker } = await executionFixture(
      (date) => notifications.push(date),
    );
    const loadBars = engineData.loadBars.bind(engineData);
    const loads: string[][] = [];
    vi.spyOn(engineData, 'loadBars').mockImplementation(async (codes) => {
      loads.push([...codes]);
      if (codes.includes('B')) {
        throw new Error('cash bars unavailable');
      }
      await loadBars(codes);
    });
    orders.beginDecision('20240102');
    orders.setHoldings({ A: 0.5 });
    orders.order('B', 100);
    orders.limitBuy('A', 5, 100);
    orders.commitDecision();

    await expect(orders.executeOrders('20240103', '20240102')).rejects.toThrow(
      'cash bars unavailable',
    );

    expect(loads).toEqual([['A'], ['B']]);
    expect(cashPortfolio.positions.get('A')?.shares).toBe(500);
    expect(notifications).toEqual(['20240103']);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toMatchObject([
      { decisionDate: '20240102', executionDate: '20240103' },
    ]);
    const drift = allocationTracker.finish(cashPortfolio.cash).drift[0];
    expect(drift.preTrade).toContainEqual({ assetId: 'A', assetClass: 'other', weight: 0 });
    expect(drift.target).toContainEqual({ assetId: 'A', assetClass: 'other', weight: 0.5 });
    expect(drift.postTrade.find((point) => point.assetId === 'A')?.weight).toBeCloseTo(
      5000 / (cashPortfolio.cash + 5000),
    );

    expect(orders.snapshot()).toMatchObject({
      pendingTargets: null,
      pendingOrders: new Map([['B', 100]]),
    });
    expect(orders.snapshot().conditionalOrders.size).toBe(1);
  });

  it('consumes rebalance before a throwing notification and preserves unattempted cash orders', async () => {
    const { orders, cashPortfolio, allocationTracker } = await executionFixture(() => {
      throw new Error('notification failed');
    });
    orders.beginDecision('20240102');
    orders.setHoldings({ A: 0.5 });
    orders.order('B', 100);
    orders.commitDecision();

    await expect(orders.executeOrders('20240103', '20240102')).rejects.toThrow(
      'notification failed',
    );

    expect(cashPortfolio.positions.has('A')).toBe(true);
    expect(cashPortfolio.positions.has('B')).toBe(false);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toHaveLength(1);
    expect(orders.snapshot().pendingTargets).toBeNull();
    expect(orders.snapshot().pendingOrders).toEqual(new Map([['B', 100]]));
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
    orders.order('A', 100);
    orders.orderLots('A', 1);
    orders.limitBuy('B', 5, 100);
    orders.commitDecision();

    await expect(orders.executeOrders('20240103', '20240102')).rejects.toThrow(
      'conditional bars unavailable',
    );
    expect(cashPortfolio.positions.get('A')?.shares).toBe(200);
    expect(orders.snapshot().pendingOrders).toBeNull();
    expect(orders.snapshot().pendingLotOrders).toBeNull();
    expect(orders.snapshot().conditionalOrders.size).toBe(1);

    await expect(orders.executeOrders('20240104', '20240103')).rejects.toThrow(
      'conditional bars unavailable',
    );
    expect(cashPortfolio.trades).toHaveLength(1);
  });

  it('consumes unfilled ordinary orders while preserving persistent limit buys', async () => {
    const { orders, cashPortfolio } = await executionFixture();
    orders.beginDecision('20240102');
    orders.order('MISSING', 100);
    orders.orderLots('MISSING', 1);
    orders.limitBuy('MISSING', 10, 100);
    orders.commitDecision();

    await orders.executeOrders('20240103', '20240102');

    expect(cashPortfolio.trades).toEqual([]);
    expect(orders.snapshot().pendingOrders).toBeNull();
    expect(orders.snapshot().pendingLotOrders).toBeNull();
    expect(orders.snapshot().conditionalOrders.get('limit_buy:MISSING')).toMatchObject({
      placedDate: '20240102',
      triggerPrice: 10,
      shares: 100,
    });
  });

  it('keeps first-day futures intents pending but reports only the current decision intents', async () => {
    const { orders, futuresPortfolio } = await executionFixture();
    const executeOrder = vi.spyOn(futuresPortfolio, 'executeOrder');
    orders.beginDecision('20240102');
    orders.orderFuture('IF.CFX', 1);
    orders.orderFuture('IF.CFX', 2);
    orders.setFutureTargetContracts('IF.CFX', 4);
    orders.orderFuture('IF.CFX', 2);
    orders.orderFuture('IF.CFX', 1);
    orders.commitDecision();
    expect(orders.hasFutureIntents).toBe(true);

    await orders.executeOrders('20240102', undefined);
    expect(executeOrder).not.toHaveBeenCalled();
    orders.beginDecision('20240103');
    expect(orders.hasFutureIntents).toBe(false);
    await orders.executeOrders('20240103', '20240102');
    expect(executeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ contractDelta: 3, decisionDate: '20240102' }),
    );

    await orders.executeOrders('20240104', '20240103');
    expect(executeOrder).toHaveBeenCalledTimes(1);
    expect(futuresPortfolio.trades).toEqual([]);
  });
});
