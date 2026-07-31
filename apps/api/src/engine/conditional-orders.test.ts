import { describe, expect, it } from 'vitest';
import { fixturePort, type FixtureBar, type FixtureSpec } from './fixture-port.js';
import { runStrategy, runStrategyWithSignals } from './run.js';
import type { BarContext, Strategy } from './types.js';

const DATES = ['20240101', '20240102', '20240103', '20240104', '20240105'];

function stock(overrides: Partial<Record<string, Partial<FixtureBar>>> = {}) {
  return {
    code: 'A',
    bars: DATES.map((date) => ({
      date,
      open: 10,
      high: 10,
      low: 10,
      close: 10,
      up: 11,
      down: 9,
      ...(overrides[date] ?? {}),
    })),
  };
}

function scripted(actions: Record<string, (ctx: BarContext) => void>): Strategy {
  return {
    name: 'conditional fixture',
    watch: ['A'],
    onBar(ctx) {
      actions[ctx.date]?.(ctx);
    },
  };
}

async function run(
  actions: Record<string, (ctx: BarContext) => void>,
  overrides: Partial<Record<string, Partial<FixtureBar>>> = {},
) {
  const spec: FixtureSpec = { dates: DATES, stocks: [stock(overrides)] };
  return runStrategy({
    start: DATES[0],
    end: DATES.at(-1)!,
    initialCash: 100_000,
    strategy: scripted(actions),
    dataPort: fixturePort(spec),
    cost: { slippageBps: 0, impactCoef: 0 },
  });
}

describe('persistent conditional orders', () => {
  it('fills a stop at its trigger and a gap-through stop at the open', async () => {
    const touched = await run(
      {
        '20240101': (ctx) => ctx.order('A', 100),
        '20240102': (ctx) => ctx.stopLoss('A', 9.5),
      },
      { '20240103': { low: 9.4 } },
    );
    expect(touched.tradeLog.map((trade) => [trade.side, trade.date, trade.price])).toEqual([
      ['buy', '20240102', 10],
      ['sell', '20240103', 9.5],
    ]);

    const gapped = await run(
      {
        '20240101': (ctx) => ctx.order('A', 100),
        '20240102': (ctx) => ctx.stopLoss('A', 9.5),
      },
      { '20240103': { open: 9.2, high: 9.3, low: 9, close: 9.1 } },
    );
    expect(gapped.tradeLog.at(-1)).toMatchObject({ side: 'sell', date: '20240103', price: 9.2 });
  });

  it('keeps a same-day buy frozen and lets the stop execute on T+1', async () => {
    const result = await run(
      {
        '20240101': (ctx) => {
          ctx.order('A', 100);
          ctx.stopLoss('A', 9.5);
        },
      },
      {
        '20240102': { low: 9.4 },
        '20240103': { low: 9.4 },
      },
    );
    expect(result.tradeLog.map((trade) => `${trade.side}@${trade.date}`)).toEqual([
      'buy@20240102',
      'sell@20240103',
    ]);
  });

  it('uses only the prior high-water mark, then trails on the following day', async () => {
    const result = await run(
      {
        '20240101': (ctx) => {
          ctx.order('A', 100);
          ctx.trailingStop('A', 0.1);
        },
        // Re-declaring must preserve the 12 high-water mark observed on D3.
        '20240103': (ctx) => ctx.trailingStop('A', 0.1),
      },
      {
        '20240103': { high: 12, low: 9.5, close: 11 },
        '20240104': { open: 11, high: 11, low: 10.7, close: 10.8 },
      },
    );
    expect(result.tradeLog.map((trade) => [trade.side, trade.date, trade.price])).toEqual([
      ['buy', '20240102', 10],
      ['sell', '20240104', 10.8],
    ]);
  });

  it('persists limit buys until touched and never fills above the limit', async () => {
    const touched = await run(
      { '20240101': (ctx) => ctx.limitBuy('A', 9.5, 100) },
      {
        '20240102': { low: 9.7 },
        '20240103': { open: 10, low: 9.4 },
      },
    );
    expect(touched.tradeLog[0]).toMatchObject({ side: 'buy', date: '20240103', price: 9.5 });

    const gapped = await run(
      { '20240101': (ctx) => ctx.limitBuy('A', 9.5, 100) },
      { '20240102': { open: 9.2, high: 9.4, low: 9, close: 9.3 } },
    );
    expect(gapped.tradeLog[0]).toMatchObject({ date: '20240102', price: 9.2 });
  });

  it('keeps a condition alive when a sealed price limit blocks the trigger', async () => {
    const result = await run(
      {
        '20240101': (ctx) => ctx.order('A', 100),
        '20240102': (ctx) => ctx.stopLoss('A', 9.5),
      },
      {
        '20240103': { open: 9, high: 9, low: 9, close: 9 },
        '20240104': { open: 10, high: 10, low: 9.4, close: 9.8 },
      },
    );
    expect(result.tradeLog.map((trade) => `${trade.side}@${trade.date}`)).toEqual([
      'buy@20240102',
      'sell@20240104',
    ]);
  });

  it('removes stale sell conditions when a next-open order closes the position', async () => {
    const result = await run(
      {
        '20240101': (ctx) => ctx.order('A', 100),
        '20240102': (ctx) => {
          ctx.stopLoss('A', 9.5);
          ctx.exit('A');
        },
        '20240103': (ctx) => ctx.order('A', 100),
      },
      { '20240105': { low: 9.4 } },
    );
    expect(result.tradeLog.map((trade) => `${trade.side}@${trade.date}`)).toEqual([
      'buy@20240102',
      'sell@20240103',
      'buy@20240104',
    ]);
  });

  it('supports take-profit, cancellation, and real-share lot sizing', async () => {
    const profit = await run(
      {
        '20240101': (ctx) => ctx.order('A', 100),
        '20240102': (ctx) => ctx.takeProfit('A', 0.1),
      },
      { '20240103': { high: 11.2 } },
    );
    expect(profit.tradeLog.at(-1)).toMatchObject({
      side: 'sell',
      date: '20240103',
      price: 11.05511,
    });

    const cancelled = await run(
      {
        '20240101': (ctx) => ctx.limitBuy('A', 9.5, 100),
        '20240102': (ctx) => ctx.cancelConditional('A', 'limit_buy'),
      },
      { '20240103': { low: 9.4 } },
    );
    expect(cancelled.trades).toBe(0);

    const adjustedSpec: FixtureSpec = {
      dates: DATES,
      stocks: [
        {
          code: 'A',
          bars: DATES.map((date, index) => ({
            date,
            open: 10,
            close: 10,
            up: 11,
            down: 9,
            adj: index === 0 ? 1 : 2,
          })),
        },
      ],
    };
    const lots = await runStrategy({
      start: DATES[0],
      end: DATES.at(-1)!,
      initialCash: 100_000,
      strategy: scripted({ '20240101': (ctx) => ctx.orderLots('A', 1) }),
      dataPort: fixturePort(adjustedSpec),
      cost: { slippageBps: 0, impactCoef: 0 },
    });
    expect(lots.tradeLog[0].realShares).toBe(100);
  });

  it('captures still-live conditions as broker-ready signal intents', async () => {
    const paired = await runStrategyWithSignals({
      start: DATES[0],
      end: DATES[0],
      initialCash: 100_000,
      strategy: scripted({
        '20240101': (ctx) => {
          ctx.orderLots('A', 1);
          ctx.stopLoss('A', 9.2);
        },
      }),
      dataPort: fixturePort({ dates: DATES, stocks: [stock()] }),
      cost: { slippageBps: 0, impactCoef: 0 },
    });
    expect(paired.capture.signals).toEqual([
      expect.objectContaining({ action: 'buy', shares: 100, source: 'order' }),
      expect.objectContaining({
        action: 'sell',
        shares: 100,
        source: 'conditional',
        orderType: 'stop_loss',
      }),
    ]);

    const output = await runStrategyWithSignals({
      start: DATES[0],
      end: '20240102',
      initialCash: 100_000,
      strategy: scripted({
        '20240101': (ctx) => ctx.order('A', 100),
        '20240102': (ctx) => ctx.trailingStop('A', 0.08),
      }),
      dataPort: fixturePort({ dates: DATES, stocks: [stock()] }),
      cost: { slippageBps: 0, impactCoef: 0 },
    });
    expect(output.capture.signals).toHaveLength(1);
    const signal = output.capture.signals[0];
    expect(signal).toMatchObject({
      code: 'A',
      action: 'sell',
      shares: 100,
      source: 'conditional',
      orderType: 'trailing_stop',
      trailingPct: 0.08,
    });
    if (signal.source !== 'conditional') {
      throw new Error('Expected a conditional signal');
    }
    expect(signal.triggerPrice).toBeCloseTo(9.2, 10);
  });

  it('models an intraday strategy stop before a close-driven next-open exit', async () => {
    const overrides = {
      '20240103': { open: 10, high: 10, low: 9.4, close: 9.4 },
      '20240104': { open: 8.5, high: 9, low: 8.3, close: 8.6, down: 7 },
    } satisfies Partial<Record<string, Partial<FixtureBar>>>;
    const intraday = await run(
      {
        '20240101': (ctx) => ctx.order('A', 100),
        '20240102': (ctx) => ctx.stopLoss('A', 9.5),
      },
      overrides,
    );
    const closeDriven = await run(
      {
        '20240101': (ctx) => ctx.order('A', 100),
        '20240103': (ctx) => {
          if ((ctx.price('A') ?? Infinity) <= 9.5) {
            ctx.exit('A');
          }
        },
      },
      overrides,
    );

    expect(intraday.tradeLog.at(-1)?.price).toBe(9.5);
    expect(closeDriven.tradeLog.at(-1)?.price).toBe(8.5);
    expect(intraday.finalValue).toBeGreaterThan(closeDriven.finalValue);
  });
});
