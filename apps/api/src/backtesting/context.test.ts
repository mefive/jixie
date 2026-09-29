import { describe, expect, it, vi } from 'vitest';
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

    expect(context.future('IF.CFX')).toEqual(bar);
    expect(context.futureHistory('IF.CFX', 'close', 1)).toEqual([100]);
    expect(futureBar).toHaveBeenCalledTimes(1);
    expect(futureHistory).toHaveBeenCalledTimes(1);
  });
});
