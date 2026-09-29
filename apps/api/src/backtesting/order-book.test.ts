import { describe, expect, it } from 'vitest';
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
