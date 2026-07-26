import { describe, expect, it } from 'vitest';
import { fixturePort, type FixtureSpec } from './fixture-port.js';
import { runStrategy } from './run.js';
import type { BarContext, Strategy } from './types.js';

const DATES = ['20240102', '20240103', '20240104', '20240105'];
const ETF_CODE = '510300.SH';

function instrument(assetType: 'stock' | 'etf'): FixtureSpec['stocks'][number] {
  return {
    code: ETF_CODE,
    assetType,
    bars: DATES.map((date) => ({ date, open: 10, close: 10 })),
  };
}

function roundTripStrategy(): Strategy {
  return {
    name: 'ETF round trip',
    watch: [ETF_CODE],
    async onBar(ctx: BarContext) {
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

    const result = await runStrategy({
      start: DATES[0],
      end: DATES.at(-1)!,
      initialCash: 100_000,
      strategy: roundTripStrategy(),
      dataPort,
      cost: { slippageBps: 0, impactCoef: 0 },
    });

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
    const etf = await runStrategy({
      start: DATES[0],
      end: DATES.at(-1)!,
      initialCash: 100_000,
      strategy: roundTripStrategy(),
      dataPort: fixturePort({ dates: DATES, stocks: [instrument('etf')] }),
      cost,
    });
    const stock = await runStrategy({
      start: DATES[0],
      end: DATES.at(-1)!,
      initialCash: 100_000,
      strategy: roundTripStrategy(),
      dataPort: fixturePort({ dates: DATES, stocks: [instrument('stock')] }),
      cost,
    });

    expect(etf.tradeLog.map((trade) => trade.fee)).toEqual([1, 1]);
    expect(stock.tradeLog.map((trade) => trade.fee)).toEqual([3, 8]);
  });
});
