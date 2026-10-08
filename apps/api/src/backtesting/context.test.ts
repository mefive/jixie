import { describe, expect, it, vi } from 'vitest';
import { AllocationAnalysisTracker } from './allocation-analysis.js';
import { BacktestingContext } from './context.js';
import { EngineData } from './data/engine-data.js';
import { CashPortfolio } from './cash-portfolio.js';
import { FuturesPortfolio } from './futures-portfolio.js';
import { OrderBook } from './order-book.js';
import { DEFAULT_COST } from './cost.js';
import { fixturePort } from './testing/fixture-port.js';

describe('context futures access', () => {
  it('exposes market data even when the futures account has no capital', () => {
    const engineData = new EngineData({
      start: '20240102',
      end: '20240102',
      dataPort: fixturePort({ dates: [], stocks: [] }),
    });
    const bar = {
      code: 'IF.CFX',
      actualCode: 'IF2401.CFX',
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      settle: 100,
      volume: 1000,
      amount: 100000,
      openInterest: 1000,
      multiplier: 300,
    };
    const futureBar = vi.spyOn(engineData, 'futureBar').mockReturnValue(bar);
    const futureHistory = vi.spyOn(engineData, 'futureHistory').mockReturnValue([100]);
    const cashPortfolio = new CashPortfolio(10000, DEFAULT_COST);
    const futuresPortfolio = new FuturesPortfolio(0, DEFAULT_COST);
    const orderBook = new OrderBook({
      engineData,
      cashPortfolio,
      futuresPortfolio,
      allocationTracker: new AllocationAnalysisTracker(10000, new Map()),
      onRebalance: () => {},
      cost: DEFAULT_COST,
    });
    const context = new BacktestingContext({
      date: '20240102',
      engineData,
      cashPortfolio,
      futuresPortfolio,
      orderBook,
      factorEvaluator: null,
    });

    expect(context.portfolio.equity).toBe(10000);
    expect(context.stock.equity).toBe(10000);
    expect(context.stock.availableCash).toBe(10000);
    expect(context.futures.equity).toBe(0);
    expect(context.futures.availableCash).toBe(0);
    expect('order' in context).toBe(false);
    expect('orderFuture' in context).toBe(false);

    orderBook.beginDecision('20240102');
    context.stock.orderAdjustedShares('AAA', 100);
    context.stock.orderAdjustedShares('AAA', 50);
    context.futures.orderContracts('IF.CFX', -2);
    orderBook.commitDecision();
    expect(orderBook.snapshotCashOrders().pendingOrders?.get('AAA')).toBe(150);
    expect(orderBook.snapshotFuturesOrders()).toEqual([
      { code: 'IF.CFX', intent: { kind: 'delta', value: -2 } },
    ]);

    expect(context.future('IF.CFX')).toEqual(bar);
    expect(context.futureHistory('IF.CFX', 'close', 1)).toEqual([100]);
    expect(futureBar).toHaveBeenCalledTimes(1);
    expect(futureHistory).toHaveBeenCalledTimes(1);
  });
});
