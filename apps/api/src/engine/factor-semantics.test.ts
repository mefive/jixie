import { describe, expect, it } from 'vitest';
import { runStrategy } from './run.js';
import { runWalledBacktest } from './walled-run.js';
import { fixturePort, type FixtureSpec } from './fixture-port.js';
import { toCommonJs } from '../lib/isolate-run.js';
import type { Strategy } from './types.js';

/**
 * ctx.factor() time semantics (factor-to-strategy.md Step 2): a `flow` factor (moneyflow) is an
 * exact-day quantity — yesterday's net inflow must NEVER be served as today's. Before 3.2 the
 * engine blanket-applied as-of forward filling to every stored factor; these tests pin the fix.
 */

const D = ['20240101', '20240102', '20240103', '20240104', '20240105'];

function spec(): FixtureSpec {
  return {
    dates: D,
    stocks: [
      {
        code: 'A',
        bars: D.map((date) => ({ date, open: 10, close: 10, up: 11, down: 9 })),
      },
    ],
    // Moneyflow exists ONLY on D2 — D3+ must read null, not D2's value carried forward.
    moneyflow: [{ tsCode: 'A', tradeDate: D[1], netMain: 888, netTotal: 999 }],
  };
}

/** Record ctx.factor('mf_net_main') for stock A on every bar. */
function recordingStrategy(seen: Record<string, number | null>): Strategy {
  return {
    name: 'record mf',
    factors: ['mf_net_main'],
    onBar(ctx) {
      seen[ctx.date] = ctx.factor('mf_net_main', 'A');
    },
  };
}

describe('flow factor semantics (mf_net_*)', () => {
  it('serves the exact day and returns null after — no forward fill', async () => {
    const seen: Record<string, number | null> = {};
    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy: recordingStrategy(seen),
      dataPort: fixturePort(spec()),
    });

    expect(seen[D[0]]).toBeNull(); // before any data
    expect(seen[D[1]]).toBe(888); // the exact day
    expect(seen[D[2]]).toBeNull(); // the old behavior forward-filled 888 here
    expect(seen[D[4]]).toBeNull();
  });

  it('rejects an unknown factor key at load instead of serving silent nulls', async () => {
    const bogus: Strategy = { name: 'bogus', factors: ['mf_net_mian'], onBar() {} };
    await expect(
      runStrategy({
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        strategy: bogus,
        dataPort: fixturePort(spec()),
      }),
    ).rejects.toThrow(/mf_net_mian/);
  });

  it('a declared custom key without a prepared module fails loudly (deleted/foreign factor)', async () => {
    const custom: Strategy = {
      name: 'custom ref',
      factors: ['custom:missing_factor'],
      onBar() {},
    };
    await expect(
      runStrategy({
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        strategy: custom,
        dataPort: fixturePort(spec()),
      }),
    ).rejects.toThrow(/custom:missing_factor/);
  });
});

describe('custom (defineFactor) factors inside the engine', () => {
  function specWithValuation(): FixtureSpec {
    const base = spec();
    base.stocks[0].basic = Object.fromEntries(D.map((date) => [date, { peTtm: 10 }]));
    return base;
  }

  it('cross-sectional factor computes from the day bar (peTtm doubled)', async () => {
    const js = await toCommonJs(
      `export default defineFactor({ name: 'double pe', compute: (bar) => (bar.peTtm == null ? null : bar.peTtm * 2) });`,
      'factor code',
    );
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read custom',
      factors: ['custom:f1'],
      async onBar(ctx) {
        await ctx.loadCrossSection();
        seen[ctx.date] = ctx.factor('custom:f1', 'A');
      },
    };
    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(specWithValuation()),
      customFactors: [{ key: 'custom:f1', js }],
    });
    expect(seen[D[0]]).toBe(20);
    expect(seen[D[4]]).toBe(20);
  });

  it('windowed factor reads ctx.history from the engine bars cache (after ensureBars)', async () => {
    const js = await toCommonJs(
      `export default defineFactor({
        name: 'sum3',
        window: 3,
        compute(bar, ctx) {
          const closes = ctx.history(3);
          if (closes.length < 3) { return null; }
          return closes[0] + closes[1] + closes[2];
        },
      });`,
      'factor code',
    );
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read windowed',
      factors: ['custom:w1'],
      async onBar(ctx) {
        await ctx.ensureBars(['A']);
        seen[ctx.date] = ctx.factor('custom:w1', 'A');
      },
    };
    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(spec()),
      customFactors: [{ key: 'custom:w1', js }],
    });
    expect(seen[D[0]]).toBeNull(); // only 1 bar of history — window unfilled
    expect(seen[D[1]]).toBeNull();
    expect(seen[D[2]]).toBe(30); // three 10-yuan closes
    expect(seen[D[4]]).toBe(30);
  });

  it('windowed factor reads aligned turnover amounts inside the backtest engine', async () => {
    const amountSpec = spec();
    amountSpec.stocks[0].bars = D.map((date, index) => ({
      date,
      open: 10,
      close: 10,
      up: 11,
      down: 9,
      amount: (index + 1) * 100,
    }));
    const js = await toCommonJs(
      `export default defineFactor({
        name: 'amount3',
        window: 3,
        compute(bar, ctx) {
          const amounts = ctx.history(3, 'amount');
          if (amounts.length < 3 || amounts.some((value) => value == null)) { return null; }
          return amounts.reduce((sum, value) => sum + value, 0);
        },
      });`,
      'factor code',
    );
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read amount history',
      factors: ['custom:amount'],
      async onBar(ctx) {
        await ctx.ensureBars(['A']);
        seen[ctx.date] = ctx.factor('custom:amount', 'A');
      },
    };

    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(amountSpec),
      customFactors: [{ key: 'custom:amount', js }],
    });

    expect(seen[D[1]]).toBeNull();
    expect(seen[D[2]]).toBe(600);
    expect(seen[D[4]]).toBe(1200);
  });

  it('walled lane: the same custom factor computes in-wall (values logged through the wall match)', async () => {
    const js = await toCommonJs(
      `export default defineFactor({ name: 'double pe', compute: (bar) => (bar.peTtm == null ? null : bar.peTtm * 2) });`,
      'factor code',
    );
    const strategyCode = `
      export default defineStrategy({
        name: 'walled custom read',
        factors: ['custom:f1'],
        async onBar(ctx) {
          await ctx.universe();
          console.log(ctx.date + '=' + String(ctx.factor('custom:f1', 'A')));
        },
      });`;
    const logged: string[] = [];
    await runWalledBacktest(
      {
        code: strategyCode,
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        customFactors: [{ key: 'custom:f1', js }],
      },
      fixturePort(specWithValuation()),
      undefined,
      (_level, text) => logged.push(text),
    );
    expect(logged).toContain(`${D[0]}=20`);
    expect(logged).toContain(`${D[4]}=20`);
  });
});

describe('extractCustomFactorKeys (host-side source scan)', () => {
  it('finds custom: references in factors arrays and inline reads, deduped', async () => {
    const { extractCustomFactorKeys } = await import('./prepare-custom-factors.js');
    const source = `
      export default defineStrategy({
        factors: ['custom:earnings_yield', 'mf_net_main'],
        onBar(ctx) {
          ctx.factor('custom:earnings_yield', 'A');
          ctx.factor('custom:mom_12_1', 'A'); // a builtin preset referenced by slug
          ctx.factor('custom:01ARZ3NDEKTSV4RRFFQ69G5FAV', 'A'); // legacy ULID: ignored
        },
      });`;
    expect(extractCustomFactorKeys(source)).toEqual(['custom:earnings_yield', 'custom:mom_12_1']);
  });
});
