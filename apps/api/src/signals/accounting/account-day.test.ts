import { describe, expect, it } from 'vitest';
import type { FutureSignalItem, SignalAccounts } from '@jixie/shared';
import type { SignalFillInput } from '@jixie/shared/api/signals';
import { EngineData } from '#backtesting/data/engine-data.js';
import { fixturePort } from '#backtesting/testing/fixture-port.js';
import { DEFAULT_COST } from '#backtesting/cost.js';
import { applyActualAccountDay, simulateAccountDay } from './account-day.js';

const dates = ['20240603', '20240604', '20240605'];
const cost = { ...DEFAULT_COST, futureSlippageTicks: 0, futureCommissionRate: 0 };
const intent: FutureSignalItem = {
  assetType: 'future',
  code: 'IF.CFX',
  name: 'IF',
  intent: { kind: 'contracts', value: 2 },
  decisionDate: dates[0]!,
  execDate: dates[1]!,
  actualCode: 'IF2406.CFX',
  mappingDate: dates[0]!,
  referencePrice: 4000,
  multiplier: 300,
  referenceTargetContracts: 2,
  referenceNotional: 2400000,
  referenceMargin: 288000,
  marginSource: 'config',
  referenceLegs: [],
};
function baseline(): SignalAccounts {
  return {
    version: 2,
    date: dates[0]!,
    cash: 100000,
    positions: [],
    futures: { equity: 500000, availableCash: 500000, margin: 0, positions: [] },
    equity: 600000,
    risk: [],
    conditions: [],
    consumedConditions: [],
  };
}
async function data(missingSettlement = false) {
  const result = new EngineData({
    start: dates[0]!,
    end: dates[2]!,
    strictFutures: true,
    dataPort: fixturePort({
      dates,
      stocks: [
        { code: 'A', bars: dates.map((date) => ({ date, open: 10, high: 11, low: 9, close: 10 })) },
      ],
      futureContracts: ['IF2406.CFX', 'IF2409.CFX'].map((tsCode) => ({
        tsCode,
        productCode: 'IF',
        multiplier: 300,
        listDate: '20240101',
        delistDate: '20241231',
      })),
      futureDaily: ['IF2406.CFX', 'IF2409.CFX'].flatMap((tsCode) =>
        dates.map((tradeDate, index) => ({
          tsCode,
          tradeDate,
          open: 4000,
          high: 4100,
          low: 3900,
          close: 4000 + index * 10,
          settle: missingSettlement && index === 1 ? null : 4000 + index * 10,
          volume: 10000,
          amount: 100000,
          openInterest: 10000,
        })),
      ),
      futureMappings: dates.map((tradeDate) => ({
        continuousCode: 'IF.CFX',
        mappedTsCode: 'IF2406.CFX',
        tradeDate,
      })),
    }),
  });
  await result.load();

  return result;
}
function fill(overrides: Partial<SignalFillInput> = {}): SignalFillInput {
  return {
    expectedRevision: 0,
    clientRequestId: 'fixture',
    actualCode: 'IF2406.CFX',
    action: 'buy',
    effect: 'open',
    quantity: 1,
    price: 4000,
    fee: 5,
    tradeDate: dates[1]!,
    executedAt: '2024-06-04T02:00:00Z',
    sequence: 0,
    reason: 'fixture',
    ...overrides,
  };
}

describe('versioned account days', () => {
  it('settles actual positions on days without signals without adding margin to equity', async () => {
    const prior = baseline();
    const market = await data();
    const first = applyActualAccountDay(
      { prior, date: dates[1]!, previousDate: dates[0]!, data: market, cost, intents: [] },
      [{ intent, fill: fill() }],
    );
    expect(first.futures.equity).toBe(502995);
    expect(first.equity).toBe(602995);
    const next = applyActualAccountDay(
      { prior: first, date: dates[2]!, previousDate: dates[1]!, data: market, cost, intents: [] },
      [],
    );
    expect(next.futures.equity).toBe(505995);
    expect(prior).toEqual(baseline());
  });

  it('retains a partial roll and allows observed fills beyond simulation margin', async () => {
    const prior = baseline();
    prior.futures.equity = 1;
    prior.futures.positions = [
      {
        code: 'IF.CFX',
        actualCode: 'IF2406.CFX',
        contracts: 2,
        referencePrice: 4000,
        multiplier: 300,
        margin: 288000,
      },
    ];
    const state = applyActualAccountDay(
      { prior, date: dates[1]!, previousDate: dates[0]!, data: await data(), cost, intents: [] },
      [
        { intent, fill: fill({ action: 'sell', effect: 'close' }) },
        { intent, fill: fill({ actualCode: 'IF2409.CFX', sequence: 1 }) },
      ],
    );
    expect(state.futures.positions.map((position) => position.actualCode)).toEqual([
      'IF2406.CFX',
      'IF2409.CFX',
    ]);
    expect(state.risk).toContain('margin_call');
    expect(state.cash).toBe(100000);
  });

  it('fails missing settlement without mutating the prior account', async () => {
    const prior = baseline();
    const market = await data(true);
    expect(() =>
      applyActualAccountDay(
        { prior, date: dates[1]!, previousDate: dates[0]!, data: market, cost, intents: [] },
        [{ intent, fill: fill() }],
      ),
    ).toThrow();
    expect(prior).toEqual(baseline());
  });

  it('executes conditions before a hedge and does not resurrect a consumed condition', async () => {
    const prior = baseline();
    prior.positions = [
      {
        code: 'A',
        assetType: 'stock',
        shares: 1000,
        avgCost: 10,
        frozenShares: 0,
        frozenUntil: dates[0]!,
        markPrice: 10,
        adjustmentFactor: 1,
      },
    ];
    prior.futures.positions = [
      {
        code: 'IF.CFX',
        actualCode: 'IF2406.CFX',
        contracts: -1,
        referencePrice: 4000,
        multiplier: 300,
        margin: 144000,
      },
    ];
    prior.futures.margin = 144000;
    prior.futures.availableCash = prior.futures.equity - 144000;
    prior.conditions = [
      { key: 'stop_loss:A', code: 'A', kind: 'stop_loss', placedDate: dates[0]!, triggerPrice: 11 },
    ];
    const market = await data();
    const result = await simulateAccountDay({
      prior,
      date: dates[1]!,
      previousDate: dates[0]!,
      data: market,
      cost,
      intents: [{ ...intent, intent: { kind: 'hedge', value: 1 } }],
    });
    expect(result.state.positions).toEqual([]);
    expect(result.state.futures.positions).toEqual([]);
    expect(result.state.consumedConditions).toContain('stop_loss:A:20240603');
    const next = await simulateAccountDay({
      prior: result.state,
      date: dates[2]!,
      previousDate: dates[1]!,
      data: market,
      cost,
      intents: [],
      conditions: prior.conditions,
    });
    expect(next.trades).toEqual([]);
    expect(next.state.conditions).toEqual([]);
  });

  it('keeps zero-funded simulated orders from using cash-account capital', async () => {
    const prior = baseline();
    prior.futures.equity = 0;
    prior.futures.availableCash = 0;
    prior.equity = prior.cash;
    const result = await simulateAccountDay({
      prior,
      date: dates[1]!,
      previousDate: dates[0]!,
      data: await data(),
      cost,
      intents: [intent],
    });
    expect(result.trades).toEqual([]);
    expect(result.state.cash).toBe(prior.cash);
    expect(result.state.futures.equity).toBe(0);
  });
});
