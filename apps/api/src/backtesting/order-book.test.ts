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
    orders.orderStockAdjustedShares('A', 100);
    orders.commitDecision();
    await orders.executeOrders('20240103', '20240102');
    expect(cashPortfolio.positions.get('A')?.shares).toBe(100);
    expect(notifications).toEqual([]);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toEqual([]);

    orders.beginDecision('20240103');
    orders.setStockTargetWeights(new Map());
    orders.commitDecision();
    expect(orders.snapshotCashOrders().pendingTargets).toEqual(new Map());
    await orders.executeOrders('20240104', '20240103');

    expect(cashPortfolio.positions.size).toBe(0);
    expect(orders.snapshotCashOrders().pendingTargets).toBeNull();
    expect(notifications).toEqual(['20240104']);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toMatchObject([
      { decisionDate: '20240103', executionDate: '20240104', postTradeDistance: 0 },
    ]);
  });

  it('replays legacy mixed orders and retains later orders after a load failure', async () => {
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
    orders.loadExecutionOrders({
      cashOrders: {
        pendingTargets: new Map([['A', 0.5]]),
        pendingOrders: new Map([['B', 100]]),
        pendingLotOrders: null,
        conditionalOrders: new Map([
          [
            'limit_buy:A',
            { kind: 'limit_buy', code: 'A', triggerPrice: 5, shares: 100, placedDate: '20240102' },
          ],
        ]),
      },
      futuresOrders: [],
    });

    await expect(orders.executeOrders('20240103', '20240102')).rejects.toThrow(
      'cash bars unavailable',
    );

    expect(loads).toEqual([['A'], ['B']]);
    expect(cashPortfolio.positions.get('A')?.shares).toBe(500);
    expect(notifications).toEqual(['20240103']);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toEqual([]);

    expect(orders.snapshotCashOrders()).toMatchObject({
      pendingTargets: null,
      pendingOrders: new Map([['B', 100]]),
    });
    expect(orders.snapshotCashOrders().conditionalOrders.size).toBe(1);
  });

  it('consumes rebalance before a throwing notification and preserves unattempted cash orders', async () => {
    const { orders, cashPortfolio, allocationTracker } = await executionFixture(() => {
      throw new Error('notification failed');
    });
    orders.loadExecutionOrders({
      cashOrders: {
        pendingTargets: new Map([['A', 0.5]]),
        pendingOrders: new Map([['B', 100]]),
        pendingLotOrders: null,
        conditionalOrders: new Map(),
      },
      futuresOrders: [],
    });

    await expect(orders.executeOrders('20240103', '20240102')).rejects.toThrow(
      'notification failed',
    );

    expect(cashPortfolio.positions.has('A')).toBe(true);
    expect(cashPortfolio.positions.has('B')).toBe(false);
    expect(allocationTracker.finish(cashPortfolio.cash).drift).toHaveLength(0);
    expect(orders.snapshotCashOrders().pendingTargets).toBeNull();
    expect(orders.snapshotCashOrders().pendingOrders).toEqual(new Map([['B', 100]]));
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

    await expect(orders.executeOrders('20240103', '20240102')).rejects.toThrow(
      'conditional bars unavailable',
    );
    expect(cashPortfolio.positions.get('A')?.shares).toBe(200);
    expect(orders.snapshotCashOrders().pendingOrders).toBeNull();
    expect(orders.snapshotCashOrders().pendingLotOrders).toBeNull();
    expect(orders.snapshotCashOrders().conditionalOrders.size).toBe(1);

    await expect(orders.executeOrders('20240104', '20240103')).rejects.toThrow(
      'conditional bars unavailable',
    );
    expect(cashPortfolio.trades).toHaveLength(1);
  });

  it('consumes unfilled ordinary orders while preserving persistent limit buys', async () => {
    const { orders, cashPortfolio } = await executionFixture();
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('MISSING', 100);
    orders.orderStockLots('MISSING', 1);
    orders.setStockLimitBuyAtAdjustedPrice('MISSING', 10, 100);
    orders.commitDecision();

    await orders.executeOrders('20240103', '20240102');

    expect(cashPortfolio.trades).toEqual([]);
    expect(orders.snapshotCashOrders().pendingOrders).toBeNull();
    expect(orders.snapshotCashOrders().pendingLotOrders).toBeNull();
    expect(orders.snapshotCashOrders().conditionalOrders.get('limit_buy:MISSING')).toMatchObject({
      placedDate: '20240102',
      triggerPrice: 10,
      shares: 100,
    });
  });

  it('keeps first-day futures intents pending and snapshots the committed intent', async () => {
    const { orders, futuresPortfolio } = await executionFixture();
    const executeOrder = vi.spyOn(futuresPortfolio, 'executeOrder');
    orders.beginDecision('20240102');
    orders.orderFuturesContracts('IF.CFX', 1);
    orders.orderFuturesContracts('IF.CFX', 2);

    orders.commitDecision();
    expect(orders.snapshotFuturesOrders()).toEqual([
      { code: 'IF.CFX', intent: { kind: 'delta', value: 3 } },
    ]);

    await orders.executeOrders('20240102', undefined);
    expect(executeOrder).not.toHaveBeenCalled();
    orders.beginDecision('20240103');
    expect(orders.snapshotFuturesOrders()).toHaveLength(1);
    await orders.executeOrders('20240103', '20240102');
    expect(executeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ contractDelta: 3, decisionDate: '20240102' }),
    );

    await orders.executeOrders('20240104', '20240103');
    expect(executeOrder).toHaveBeenCalledTimes(1);
    expect(futuresPortfolio.trades).toEqual([]);
  });
});

describe('loaded execution orders', () => {
  it('detaches loaded input and replaces the whole execution batch on the next load', async () => {
    const { orders } = await executionFixture();
    const cashOrders = {
      pendingTargets: null,
      pendingOrders: new Map([['A', 100]]),
      pendingLotOrders: new Map([['B', 1]]),
      conditionalOrders: new Map([
        [
          'limit_buy:A',
          {
            kind: 'limit_buy' as const,
            code: 'A',
            triggerPrice: 5,
            shares: 100,
            placedDate: '20240102',
          },
        ],
      ]),
    };
    const futuresOrders = [{ code: 'IF.CFX', intent: { kind: 'contracts' as const, value: 2 } }];
    orders.loadExecutionOrders({ cashOrders, futuresOrders });
    cashOrders.pendingOrders.set('A', 999);
    cashOrders.conditionalOrders.get('limit_buy:A')!.triggerPrice = 999;
    futuresOrders[0].intent.value = 999;

    expect(orders.snapshotCashOrders().pendingOrders?.get('A')).toBe(100);
    expect(orders.snapshotCashOrders().conditionalOrders.get('limit_buy:A')).toMatchObject({
      triggerPrice: 5,
    });
    expect(orders.snapshotFuturesOrders()).toEqual([
      { code: 'IF.CFX', intent: { kind: 'contracts', value: 2 } },
    ]);

    orders.loadExecutionOrders({
      cashOrders: {
        pendingTargets: null,
        pendingOrders: null,
        pendingLotOrders: null,
        conditionalOrders: new Map(),
      },
      futuresOrders: [],
    });

    expect(orders.snapshotCashOrders()).toEqual({
      pendingTargets: null,
      pendingOrders: null,
      pendingLotOrders: null,
      conditionalOrders: new Map(),
    });
    expect(orders.snapshotFuturesOrders()).toEqual([]);
  });

  it('normalizes loaded futures intents with ordered delta accumulation and target replacement', async () => {
    const { orders } = await executionFixture();
    orders.loadExecutionOrders({
      cashOrders: {
        pendingTargets: null,
        pendingOrders: null,
        pendingLotOrders: null,
        conditionalOrders: new Map(),
      },
      futuresOrders: [
        { code: 'IF.CFX', intent: { kind: 'delta', value: 1.9 } },
        { code: 'IF.CFX', intent: { kind: 'delta', value: 2.9 } },
        { code: 'IF.CFX', intent: { kind: 'contracts', value: 8.9 } },
        { code: 'IF.CFX', intent: { kind: 'delta', value: -2.9 } },
        { code: 'IF.CFX', intent: { kind: 'delta', value: 0.9 } },
        { code: 'IF.CFX', intent: { kind: 'delta', value: -1.9 } },
        { code: 'IH.CFX', intent: { kind: 'contracts', value: 4.9 } },
        { code: 'IC.CFX', intent: { kind: 'notional', value: -12345.6 } },
        { code: 'IM.CFX', intent: { kind: 'hedge', value: 0.5 } },
      ],
    });

    expect(orders.snapshotFuturesOrders()).toEqual([
      { code: 'IF.CFX', intent: { kind: 'delta', value: -3 } },
      { code: 'IH.CFX', intent: { kind: 'contracts', value: 4 } },
      { code: 'IC.CFX', intent: { kind: 'notional', value: -12345.6 } },
      { code: 'IM.CFX', intent: { kind: 'hedge', value: 0.5 } },
    ]);
  });

  it.each([
    { kind: 'delta' as const, value: NaN },
    { kind: 'contracts' as const, value: Infinity },
    { kind: 'notional' as const, value: -Infinity },
    { kind: 'hedge' as const, value: -1 },
  ])(
    'rejects invalid loaded $kind intents synchronously before replacing execution state',
    async (intent) => {
      const { orders } = await executionFixture();
      orders.beginDecision('20240102');
      orders.orderStockAdjustedShares('A', 100);
      orders.commitDecision();

      expect(() =>
        orders.loadExecutionOrders({
          cashOrders: {
            pendingTargets: null,
            pendingOrders: null,
            pendingLotOrders: null,
            conditionalOrders: new Map(),
          },
          futuresOrders: [{ code: 'IF.CFX', intent }],
        }),
      ).toThrow();
      expect(orders.snapshotCashOrders().pendingOrders).toEqual(new Map([['A', 100]]));
    },
  );

  it('executes loaded cash orders once without strategy collection', async () => {
    const { orders, cashPortfolio } = await executionFixture();
    orders.loadExecutionOrders({
      cashOrders: {
        pendingTargets: null,
        pendingOrders: new Map([['A', 100]]),
        pendingLotOrders: new Map([['A', 1]]),
        conditionalOrders: new Map(),
      },
      futuresOrders: [],
    });

    await orders.executeOrders('20240103', '20240102');
    await orders.executeOrders('20240104', '20240103');

    expect(cashPortfolio.positions.get('A')?.shares).toBe(200);
    expect(cashPortfolio.trades).toHaveLength(1);
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

  it('accumulates deltas, replaces targets and isolates futures conflicts by code', async () => {
    const { orders } = await executionFixture();
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('A', 100);
    orders.orderStockAdjustedShares('A', -20);
    orders.orderFuturesContracts('IF.CFX', 1.9);
    orders.orderFuturesContracts('IF.CFX', 2.1);
    orders.setFuturesTargetContracts('IH.CFX', 2);
    orders.setFuturesTargetNotional('IH.CFX', 90000);
    expect(() => orders.setFuturesTargetContracts('IF.CFX', 5)).toThrow(/不能混用|cannot mix/);
    expect(() => orders.orderFuturesContracts('IH.CFX', 1)).toThrow(/不能混用|cannot mix/);
    orders.commitDecision();

    expect(orders.snapshotCashOrders().pendingOrders).toEqual(new Map([['A', 80]]));
    expect(orders.snapshotFuturesOrders()).toEqual([
      { code: 'IF.CFX', intent: { kind: 'delta', value: 3 } },
      { code: 'IH.CFX', intent: { kind: 'notional', value: 90000 } },
    ]);
  });

  it('closes a stock position once and cancels preceding buys in both units', async () => {
    const { orders, cashPortfolio } = await executionFixture();
    orders.beginDecision('20240102');
    orders.orderStockAdjustedShares('A', 100);
    orders.commitDecision();
    await orders.executeOrders('20240103', '20240102');

    orders.beginDecision('20240103');
    orders.orderStockAdjustedShares('A', 300);
    orders.orderStockLots('A', 2);
    orders.closeStockPosition('A');
    orders.closeStockPosition('A');
    expect(() => orders.orderStockAdjustedShares('A', 1)).toThrow(/不能混用|cannot mix/);
    orders.commitDecision();
    expect(orders.snapshotCashOrders().pendingOrders?.get('A')).toBe(-100);
    expect(orders.snapshotCashOrders().pendingLotOrders?.has('A')).toBe(false);
    await orders.executeOrders('20240104', '20240103');

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
    orders.setFuturesTargetContracts('IF.CFX', 3);
    orders.closeFuturesPosition('IF.CFX');
    expect(() => orders.orderFuturesContracts('IF.CFX', 1)).toThrow(/不能混用|cannot mix/);
    orders.setFuturesTargetContracts('IF.CFX', 2);
    orders.commitDecision();

    expect(orders.snapshotCashOrders().pendingTargets?.get('A')).toBe(0.3);
    expect(orders.snapshotFuturesOrders()).toEqual([
      { code: 'IF.CFX', intent: { kind: 'contracts', value: 2 } },
    ]);
  });

  it('normalizes loaded cash deltas without applying new-decision conflicts to old snapshots', async () => {
    const { orders, cashPortfolio } = await executionFixture();
    orders.loadExecutionOrders({
      cashOrders: {
        pendingTargets: new Map([['A', 0.5]]),
        pendingOrders: null,
        pendingLotOrders: null,
        conditionalOrders: new Map(),
      },
      cashDeltas: [
        { code: 'A', shares: -40 },
        { code: 'A', shares: -60 },
      ],
      futuresOrders: [
        { code: 'IF.CFX', intent: { kind: 'contracts', value: 2 } },
        { code: 'IF.CFX', intent: { kind: 'delta', value: 1 } },
      ],
    });
    expect(orders.snapshotCashOrders().pendingOrders?.get('A')).toBe(-100);
    expect(orders.snapshotFuturesOrders()).toEqual([
      { code: 'IF.CFX', intent: { kind: 'delta', value: 1 } },
    ]);
    await orders.executeOrders('20240103', undefined);

    // The historical target fills first; T+1 blocks the following sale of the new shares.
    expect(cashPortfolio.trades.map((trade) => trade.side)).toEqual(['buy']);
    expect(cashPortfolio.positions.get('A')?.shares).toBe(500);
  });
});
