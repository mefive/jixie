import { describe, expect, it } from 'vitest';
import { runStrategy } from './run.js';
import { runWalledBacktest } from './walled-run.js';
import { compileStrategy } from '../strategy/code/compile.js';
import { fixturePort, type FixtureSpec } from './fixture-port.js';

/**
 * Dual-lane drift guard (定死护栏, python-and-sandbox.md Phase B): the SAME strategy code over the
 * SAME fixture world must produce identical results on the direct lane (host new Function + fixture
 * port) and the walled lane (engine bundled into an isolated-vm isolate, data served across the
 * bridge). If the bundle, the serialization, or the applySyncPromise bridge breaks, this goes red —
 * nobody has to notice by eyeballing a backtest.
 */

const D = ['20240101', '20240102', '20240103', '20240104', '20240105', '20240108'];

const SPEC: FixtureSpec = {
  dates: D,
  stocks: [
    {
      code: 'AAA',
      bars: D.map((date, i) => ({
        date,
        open: 10 + i * 0.3,
        close: 10.2 + i * 0.3,
        up: 20,
        down: 5,
        amount: 5000, // thousand yuan — exercises the impact term
      })),
    },
    {
      code: 'BBB',
      bars: D.map((date, i) => ({
        date,
        open: 50 - i,
        close: 49.5 - i,
        up: 60,
        down: 30,
        amount: 8000,
      })),
    },
  ],
  futureContracts: [
    {
      tsCode: 'IF2401.CFX',
      productCode: 'IF',
      multiplier: 300,
      listDate: '20230101',
      delistDate: '20241231',
    },
  ],
  futureDaily: D.map((tradeDate, index) => ({
    tsCode: 'IF2401.CFX',
    tradeDate,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    settle: 101 + index,
    volume: 1000,
    amount: 10_000,
    openInterest: 20_000,
  })),
  futureMappings: D.map((tradeDate) => ({
    continuousCode: 'IF.CFX',
    tradeDate,
    mappedTsCode: 'IF2401.CFX',
  })),
};

// Buys both names on D1 (fills D2), rotates out of BBB mid-run, exits everything at the end —
// exercises orders, targets, T+1, fees and slippage in one pass.
const STRATEGY_CODE = `
export default defineStrategy({
  name: 'drift-guard',
  watch: ['AAA', 'BBB'],
  onBar(ctx) {
    if (ctx.date === '20240101') {
      ctx.setHoldings({ AAA: 0.4, BBB: 0.4 });
    }
    if (ctx.date === '20240103') {
      ctx.exit('BBB');
    }
    if (ctx.date === '20240105') {
      ctx.exit('AAA');
    }
    console.log('bar', ctx.date, Math.round(ctx.value));
  },
});
`;

describe('双车道防漂移(直跑 vs 进墙,同一 fixture)', () => {
  it('净值逐日一致、成交逐笔一致、用户日志穿墙到达', { timeout: 60_000 }, async () => {
    const direct = await runStrategy({
      start: D[0],
      end: D[D.length - 1],
      initialCash: 100_000,
      strategy: await compileStrategy(STRATEGY_CODE),
      dataPort: fixturePort(SPEC),
    });

    const walledUserLogs: string[] = [];
    const walled = await runWalledBacktest(
      {
        code: STRATEGY_CODE,
        start: D[0],
        end: D[D.length - 1],
        initialCash: 100_000,
      },
      fixturePort(SPEC),
      undefined,
      (_level, text) => walledUserLogs.push(text),
    );

    expect(walled.nav).toEqual(direct.nav); // daily equity, bit-for-bit
    expect(walled.tradeLog).toEqual(direct.tradeLog); // every fill: price/shares/fees
    expect(walled.totalReturn).toBe(direct.totalReturn);
    expect(walled.sharpe).toBe(direct.sharpe);
    expect(walledUserLogs.length).toBe(D.length); // one console.log per bar crossed the wall
    expect(walledUserLogs[0]).toContain('bar 20240101');
  });

  it('墙内策略代码逃逸不到宿主(process 为 undefined)', { timeout: 60_000 }, async () => {
    const probe = `
      export default defineStrategy({
        name: 'escape-probe',
        watch: ['AAA'],
        onBar(ctx) {
          if (ctx.date !== '20240101') return;
          const escaped = ({}).constructor.constructor('return typeof globalThis.process')();
          console.log('process-type:' + escaped);
        },
      });
    `;
    const logs: string[] = [];
    await runWalledBacktest(
      { code: probe, start: D[0], end: D[D.length - 1], initialCash: 100_000 },
      fixturePort(SPEC),
      undefined,
      (_level, text) => logs.push(text),
    );
    expect(logs.some((line) => line.includes('process-type:undefined'))).toBe(true);
  });

  it('期货逐日盯市与成交在直跑和进墙车道一致', { timeout: 60_000 }, async () => {
    const code = `
      export default defineStrategy({
        name: 'future-drift',
        futures: ['IF.CFX'],
        onBar(ctx) {
          if (ctx.date === '${D[0]}') ctx.orderFuture('IF.CFX', 1);
          if (ctx.date === '${D[3]}') ctx.exitFuture('IF.CFX');
        },
      });
    `;
    const direct = await runStrategy({
      start: D[0],
      end: D.at(-1)!,
      initialCash: 100_000,
      strategy: await compileStrategy(code),
      dataPort: fixturePort(SPEC),
    });
    const walled = await runWalledBacktest(
      { code, start: D[0], end: D.at(-1)!, initialCash: 100_000 },
      fixturePort(SPEC),
    );

    expect(walled.nav).toEqual(direct.nav);
    expect(walled.tradeLog).toEqual(direct.tradeLog);
  });

  it('股票成交后动态计算期货对冲在直跑和进墙车道一致', { timeout: 60_000 }, async () => {
    const code = `
      export default defineStrategy({
        name: 'mixed-drift',
        watch: ['AAA'],
        futures: ['IF.CFX'],
        accounts: { stock: { cashWeight: 0.7 }, futures: { cashWeight: 0.3 } },
        onBar(ctx) {
          if (ctx.date === '${D[0]}') {
            ctx.setHoldings({ AAA: 1 });
            ctx.hedgeFuture('IF.CFX');
          }
        },
      });
    `;
    const direct = await runStrategy({
      start: D[0],
      end: D.at(-1)!,
      initialCash: 100_000,
      strategy: await compileStrategy(code),
      dataPort: fixturePort(SPEC),
    });
    const walled = await runWalledBacktest(
      { code, start: D[0], end: D.at(-1)!, initialCash: 100_000 },
      fixturePort(SPEC),
    );

    expect(walled.nav).toEqual(direct.nav);
    expect(walled.sleeveNav).toEqual(direct.sleeveNav);
    expect(walled.tradeLog).toEqual(direct.tradeLog);
  });
});
