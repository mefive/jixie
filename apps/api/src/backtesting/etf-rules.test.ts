import { describe, expect, it } from 'vitest';
import { fixturePort, type FixtureSpec } from './testing/fixture-port.js';
import { BacktestingEngine } from './engine.js';
import type { EngineContext, EngineStrategy } from './contract.js';

const DATES = ['20240102', '20240103', '20240104', '20240105'];
const ETF_CODE = '510300.SH';

function instrument(assetType: 'stock' | 'etf'): FixtureSpec['stocks'][number] {
  return {
    code: ETF_CODE,
    assetType,
    bars: DATES.map((date) => ({ date, open: 10, close: 10 })),
  };
}

function roundTripStrategy(): EngineStrategy {
  return {
    name: 'ETF round trip',
    watch: [ETF_CODE],
    async onBar(ctx: EngineContext) {
      if (ctx.date === DATES[0]) {
        ctx.order(ETF_CODE, 100);
      }
      if (ctx.date === DATES[1]) {
        ctx.exit(ETF_CODE);
      }
    },
  };
}

describe('ETF daily execution', () => {
  it('trades adjusted ETF bars, records ETF asset type, and excludes ETFs from stock universe', async () => {
    const dataPort = fixturePort({ dates: DATES, stocks: [instrument('etf')] });
    expect(await dataPort.crossSectionRows(DATES[0])).toEqual({
      price: [],
      adj: [],
      basic: [],
    });

    const result = await new BacktestingEngine({
      start: DATES[0],
      end: DATES.at(-1)!,
      initialCash: 100_000,
      strategy: roundTripStrategy(),
      dataPort,
      cost: { slippageBps: 0, impactCoef: 0 },
    }).run();

    expect(result.tradeLog.map((trade) => `${trade.assetType}:${trade.side}`)).toEqual([
      'etf:buy',
      'etf:sell',
    ]);
  });

  it('charges ETF commission but not stock stamp duty or transfer fee', async () => {
    const cost = {
      commission: 0.001,
      minCommission: 0,
      stampDuty: 0.005,
      transferFee: 0.002,
      slippageBps: 0,
      impactCoef: 0,
    };
    const etf = await new BacktestingEngine({
      start: DATES[0],
      end: DATES.at(-1)!,
      initialCash: 100_000,
      strategy: roundTripStrategy(),
      dataPort: fixturePort({ dates: DATES, stocks: [instrument('etf')] }),
      cost,
    }).run();
    const stock = await new BacktestingEngine({
      start: DATES[0],
      end: DATES.at(-1)!,
      initialCash: 100_000,
      strategy: roundTripStrategy(),
      dataPort: fixturePort({ dates: DATES, stocks: [instrument('stock')] }),
      cost,
    }).run();

    expect(etf.tradeLog.map((trade) => trade.fee)).toEqual([1, 1]);
    expect(stock.tradeLog.map((trade) => trade.fee)).toEqual([3, 8]);
  });
});
