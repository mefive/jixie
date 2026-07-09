import { describe, expect, it } from 'vitest';
import { runStrategy } from './run.js';
import { fixturePort, type FixtureSpec } from './fixture-port.js';
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

  it('accepts a custom:<id> key at load (compute wiring lands in 3.2 step 2)', async () => {
    const custom: Strategy = { name: 'custom ref', factors: ['custom:01ARZ3NDEKTSV'], onBar() {} };
    await expect(
      runStrategy({
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        strategy: custom,
        dataPort: fixturePort(spec()),
      }),
    ).resolves.toBeDefined();
  });
});
