import { StrategyRuntime } from '../strategy-runtime.js';
import { TypeScriptStrategyRuntime } from './typescript-strategy-runtime.js';
import { inspectStrategyMetadata } from '../inspect-definition.js';
import { describe, expect, it } from 'vitest';
import { fixturePort, type FixtureSpec } from '#engine/testing/fixture-port.js';
import { runStrategy } from '#engine/simulation/run.js';

const dates = ['20240102', '20240103'];
const fixture = {
  dates,
  stocks: [
    {
      code: 'AAA',
      bars: dates.map((date) => ({ date, open: 10, close: 10, amount: 5_000, up: 20, down: 5 })),
    },
  ],
};

async function execute(code: string, spec: FixtureSpec = fixture, start = spec.dates[0]) {
  const runtime = await TypeScriptStrategyRuntime.start({ language: 'typescript', code });
  try {
    const result = await runStrategy({
      start,
      end: spec.dates.at(-1)!,
      initialCash: 100_000,
      strategy: { ...runtime.metadata, onBar: (context) => runtime.execute({ context }) },
      dataPort: fixturePort(spec),
    });
    return { result, metrics: { ...runtime.metrics } };
  } finally {
    runtime.close();
  }
}

describe('TypeScript strategy isolation and compatibility', () => {
  it('isolates top-level metadata inspection as well as onBar', async () => {
    const code = `
      if (typeof process !== 'undefined' || typeof require === 'undefined') throw new Error('invalid globals');
      if (({}).constructor.constructor('return typeof process')() !== 'undefined') throw new Error('host escape');
      export default defineStrategy({ watch: ['AAA'], onBar() {
        if (typeof process !== 'undefined') throw new Error('host escape');
      } });
    `;
    await expect(inspectStrategyMetadata(code)).resolves.toEqual({
      watch: ['AAA'],
      factors: [],
      futures: [],
    });
    await execute(code);
  });

  it('preserves synchronous catch-and-recover behavior for invalid order intents', async () => {
    const { result } = await execute(`export default defineStrategy({ watch: ['AAA'], onBar(ctx) {
      if (ctx.date !== '${dates[0]}') return;
      let failures = 0;
      try { ctx.setHoldings({ AAA: 1.2 }); } catch { failures++; }
      try { ctx.stopLoss('AAA', -1); } catch { failures++; }
      try { ctx.orderFuture('IF.CFX', 1); } catch { failures++; }
      if (failures !== 3) throw new Error('order errors must remain synchronous');
      ctx.setHoldings(new Map([['AAA', 0.5]]));
    } });`);
    expect(result.tradeLog).toHaveLength(1);
    expect(result.tradeLog[0]).toMatchObject({ code: 'AAA', side: 'buy' });
  });

  it('retains dynamic loads, native field names, index handles and module state across bars', async () => {
    const { metrics } = await execute(`let bars = 0;
      export default defineStrategy({ async onBar(ctx) {
        bars++;
        if (bars !== (ctx.date === '${dates[0]}' ? 1 : 2)) throw new Error('module was reset');
        if (ctx.bar('AAA') !== null) throw new Error('cross-section leaked from prior date');
        await ctx.ensureBars(['AAA']);
        if (ctx.price('AAA') !== 10 || ctx.sma('AAA', 1) !== 10) throw new Error('history missing');
        await ctx.universe();
        if (ctx.bar('AAA').adjClose !== 10) throw new Error('raw row mapping changed');
        const index = ctx.index('UNSYNCED');
        if (index.close !== null || index.sma(2) !== null || index.percentile('pe') !== null) throw new Error('missing index changed');
        let rejected = false;
        try { await ctx.indexMembers('UNSYNCED'); } catch { rejected = true; }
        if (!rejected) throw new Error('missing index members must reject');
      } });`);
    expect(metrics.synchronousCalls).toBeGreaterThan(0);
    expect(metrics.receivedFrames).toBeGreaterThan(2);
  });

  it('serves watched daily windows locally after one initial history batch and daily updates', async () => {
    const { metrics } = await execute(`export default defineStrategy({ watch: ['AAA'], onBar(ctx) {
      const expected = ctx.date === '${dates[0]}' ? 1 : 2;
      if (ctx.history('AAA', 'close', 100).length !== expected) throw new Error('history drift');
      if (ctx.bars('AAA', 100).length !== expected || ctx.price('AAA') !== 10) throw new Error('bar drift');
      if (ctx.history('AAA', 'close', 0).length || ctx.bars('AAA', 0).length) throw new Error('zero window drift');
      if (ctx.sma('AAA', 1) !== 10) throw new Error('indicator drift');
    } });`);
    expect(metrics.synchronousCalls).toBe(0);
  });

  it('keeps dynamically loaded histories current without another ensureBars call', async () => {
    const { metrics } = await execute(`export default defineStrategy({ async onBar(ctx) {
      if (ctx.date === '${dates[0]}') await ctx.ensureBars(['AAA']);
      const expected = ctx.date === '${dates[0]}' ? 1 : 2;
      if (ctx.history('AAA', 'close', 100).length !== expected) throw new Error('dynamic history stale');
    } });`);
    expect(metrics.synchronousCalls).toBe(0);
  });

  it('keeps cached windows intact across repeated mixed ensureBars requests', async () => {
    const spec: FixtureSpec = {
      dates,
      stocks: ['AAA', 'BBB'].map((code) => ({ ...fixture.stocks[0], code })),
    };
    const { metrics } = await execute(
      `export default defineStrategy({ async onBar(ctx) {
      await ctx.ensureBars(['AAA']);
      await ctx.ensureBars(['AAA', 'BBB', 'AAA']);
      await ctx.ensureBars(['AAA', 'BBB']);
      const expected = ctx.date === '${dates[0]}' ? 1 : 2;
      for (const code of ['AAA', 'BBB']) {
        const bars = ctx.bars(code, 100);
        if (bars.length !== expected || new Set(bars.map(bar => bar.date)).size !== expected) throw new Error('duplicate history');
        bars[0].adjClose = -1;
        if (ctx.sma(code, 1) !== 10 || ctx.price(code) !== 10) throw new Error('cache mutated');
      }
    } });`,
      spec,
    );
    expect(metrics.synchronousCalls).toBe(0);
  });

  it('keeps history inside the run range and does not duplicate a suspended-day mark', async () => {
    const spec: FixtureSpec = {
      dates: ['20240101', '20240102', '20240103', '20240104'],
      stocks: [
        {
          code: 'AAA',
          bars: ['20240101', '20240102', '20240104'].map((date) => ({
            date,
            open: 10,
            close: 10,
            amount: 5_000,
            up: 20,
            down: 5,
          })),
        },
      ],
    };
    const { metrics } = await execute(
      `export default defineStrategy({ watch: ['AAA'], onBar(ctx) {
      const expected = ctx.date === '20240104' ? 2 : 1;
      if (ctx.history('AAA', 'close', 100).length !== expected) throw new Error('suspension history drift');
      if (ctx.price('AAA') !== 10) throw new Error('suspension price drift');
    } });`,
      spec,
      '20240102',
    );
    expect(metrics.synchronousCalls).toBe(0);
  });

  it('rejects arbitrary host operations and denies context access during initialization', async () => {
    const { result } = await execute(`
      const startup = JSON.parse(__hostAccess.applySync(undefined, [JSON.stringify({ type: 'read', request: { method: 'price', args: ['AAA'] } })]));
      if (!startup.error) throw new Error('startup context leaked');
      export default defineStrategy({ onBar(ctx) {
        const response = JSON.parse(__hostAccess.applySync(undefined, [JSON.stringify({ type: 'read', request: { method: 'constructor', args: [] } })]));
        if (!response.error) throw new Error('arbitrary dispatch allowed');
      } });
    `);
    expect(result.tradeLog).toEqual([]);
  });

  it('releases the isolate on close and rejects subsequent callbacks', async () => {
    const runtime = await StrategyRuntime.start({
      language: 'typescript',
      code: 'export default defineStrategy({ onBar() {} });',
    });
    runtime.close();
    runtime.close();
    await expect(
      runStrategy({
        start: dates[0],
        end: dates[1],
        initialCash: 100_000,
        strategy: { ...runtime.metadata, onBar: (context) => runtime.execute({ context }) },
        dataPort: fixturePort(fixture),
      }),
    ).rejects.toThrow('closed');
  });

  it('rejects external imports during metadata inspection', async () => {
    await expect(
      inspectStrategyMetadata(
        `import fs from 'node:fs'; export default defineStrategy({ name: String(fs), onBar() {} });`,
      ),
    ).rejects.toThrow('cannot import');
  });
});
