import { describe, expect, it } from 'vitest';
import { BacktestingEngine } from './engine.js';
import { fixturePort } from './testing/fixture-port.js';

// Complete a buy and a T+1 sale with ample capital so affordability does not alter the requested size.
async function roundTrip(amountThousand: number | undefined, shares: number) {
  const dates = ['20200102', '20200103', '20200106'];
  const { result } = await new BacktestingEngine({
    start: dates[0],
    end: dates.at(-1)!,
    initialCash: 100_000_000,
    dataPort: fixturePort({
      dates,
      stocks: [
        {
          code: 'A',
          bars: dates.map((date) => ({ date, open: 100, close: 100, amount: amountThousand })),
        },
      ],
    }),
    strategy: {
      name: 'slippage fixture',
      onBar(context) {
        if (context.date === dates[0]) {
          context.order('A', shares);
        } else if (context.date === dates[1]) {
          context.exit('A');
        }
      },
    },
  }).run();

  expect(result.tradeLog.map((trade) => [trade.side, trade.date, trade.realShares])).toEqual([
    ['buy', dates[1], shares],
    ['sell', dates[2], shares],
  ]);

  return { buy: result.tradeLog[0].price, sell: result.tradeLog[1].price };
}

describe('OrderBook fill slippage', () => {
  it('fills buys above and sells below the open using the configured spread and impact', async () => {
    const { buy, sell } = await roundTrip(1_000_000, 100);

    expect(buy).toBeGreaterThan(100);
    expect(sell).toBeLessThan(100);
    expect(buy).toBeCloseTo(100 * (1 + 0.0002 + 0.1 * (10_000 / 1e9)), 6);
    expect(sell).toBeCloseTo(100 * (1 - 0.0002 - 0.1 * (10_000 / 1e9)), 6);
  });

  it('charges greater impact for the same order in a thinner market', async () => {
    const thin = await roundTrip(1000, 1000);
    const liquid = await roundTrip(100_000, 1000);

    expect(thin.buy).toBeGreaterThan(liquid.buy);
    expect(thin.sell).toBeLessThan(liquid.sell);
    expect(thin.buy).toBeCloseTo(100 * (1 + 0.0002 + 0.1 * (100_000 / 1e6)), 6);
    expect(liquid.buy).toBeCloseTo(100 * (1 + 0.0002 + 0.1 * (100_000 / 1e8)), 6);
  });

  it('caps impact at 10% for a large order relative to daily turnover', async () => {
    const { buy, sell } = await roundTrip(1000, 100_000);

    expect(buy).toBeCloseTo(110, 6);
    expect(sell).toBeCloseTo(90, 6);
  });

  it('applies only the base spread when daily turnover is unavailable', async () => {
    const { buy, sell } = await roundTrip(undefined, 1000);

    expect(buy).toBeCloseTo(100 * (1 + 0.0002), 6);
    expect(sell).toBeCloseTo(100 * (1 - 0.0002), 6);
  });
});
