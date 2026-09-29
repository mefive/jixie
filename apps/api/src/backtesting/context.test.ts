import { describe, expect, it, vi } from 'vitest';
import { BacktestingContext } from './context.js';
import { EngineData } from './data/engine-data.js';
import { CashPortfolio } from './cash-portfolio.js';
import { FuturesPortfolio } from './futures-portfolio.js';
import { OrderBook } from './order-book.js';
import { DEFAULT_COST } from './cost.js';
import { fixturePort } from './testing/fixture-port.js';

describe('context futures access', () => {
  it.each([false, true])(
    'uses the explicit enabled flag (%s) to expose market data',
    (futuresEnabled) => {
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
        futuresEnabled,
        stockOrdersEnabled: true,
        cost: DEFAULT_COST,
      });
      const context = new BacktestingContext({
        date: '20240102',
        engineData,
        cashPortfolio,
        futuresPortfolio,
        futuresEnabled,
        orderBook,
        factorEvaluator: null,
      });

      expect(context.future('IF.CFX')).toEqual(futuresEnabled ? bar : null);
      expect(context.futureHistory('IF.CFX', 'close', 1)).toEqual(futuresEnabled ? [100] : []);
      expect(futureBar).toHaveBeenCalledTimes(futuresEnabled ? 1 : 0);
      expect(futureHistory).toHaveBeenCalledTimes(futuresEnabled ? 1 : 0);
    },
  );
});
