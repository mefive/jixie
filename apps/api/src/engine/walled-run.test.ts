import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { runStrategy, runStrategyWithSignals } from './run.js';
import { runWalledBacktest, runWalledSignalCapture } from './walled-run.js';
import { compileStrategy } from '../strategy/code/compile.js';
import { fixturePort, type FixtureSpec } from './fixture-port.js';

/**
 * Dual-lane drift guard (定死护栏, python-and-sandbox.md Phase B): the SAME strategy code over the
 * SAME fixture world must produce identical results on the direct lane (host new Function + fixture
 * port) and the walled lane (engine bundled into an isolated-vm isolate, data served across the
 * bridge). If the bundle, the serialization, or the async Reference bridge breaks, this goes red —
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

const PARAMETERIZED_CODE = `
  let lastPeriod = '';
  export default defineStrategy({
    name: 'parameterized-order',
    params: { sharesPerMonth: 100 },
    watch: ['AAA'],
    onBar(ctx) {
      const period = ctx.period('monthly');
      if (period === lastPeriod) return;
      lastPeriod = period;
      const price = ctx.price('AAA');
      if (price == null) return;
      const held = ctx.shares('AAA');
      const target = ctx.params.sharesPerMonth;
      if (held < target) ctx.order('AAA', target - held);
    },
  });
`;

const CATEGORICAL_PARAMETER_CODE = `
  export default defineStrategy({
    name: 'categorical-parameter',
    params: { sizing: 'disabled' },
    watch: ['AAA'],
    onBar(ctx) {
      if (ctx.date === '20240101' && ctx.params.sizing === 'fixed') {
        ctx.order('AAA', 100);
      }
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

  it('末日目标仓位信号按真实价和真实股数捕获，且双车道一致', { timeout: 60_000 }, async () => {
    const code = `
      export default defineStrategy({
        name: 'signal-capture',
        watch: ['AAA', 'BBB'],
        onBar(ctx) {
          if (ctx.date === '${D[0]}') ctx.setHoldings({ AAA: 0.5 });
          if (ctx.date === '${D.at(-1)}') ctx.setHoldings({ BBB: 0.4 });
        },
      });
    `;
    const direct = await runStrategyWithSignals({
      start: D[0],
      end: D.at(-1)!,
      initialCash: 100_000,
      strategy: await compileStrategy(code),
      dataPort: fixturePort(SPEC),
    });
    const walled = await runWalledSignalCapture(
      { code, start: D[0], end: D.at(-1)!, initialCash: 100_000 },
      fixturePort(SPEC),
    );

    expect(walled.capture).toEqual(direct.capture);
    expect(walled.result.nav).toEqual(direct.result.nav);
    expect(walled.capture.tradeDate).toBe(D.at(-1));
    expect(walled.capture.signals).toEqual([
      expect.objectContaining({ code: 'AAA', action: 'sell', source: 'target' }),
      expect.objectContaining({
        code: 'BBB',
        action: 'buy',
        source: 'target',
        shares: expect.any(Number),
        refPrice: 44.5,
      }),
    ]);
    expect(walled.capture.signals.every((signal) => signal.shares > 0)).toBe(true);
  });

  it('条件单撮合与末日存续意图在双车道一致', { timeout: 60_000 }, async () => {
    const code = `
      export default defineStrategy({
        name: 'conditional-drift',
        watch: ['AAA'],
        onBar(ctx) {
          if (ctx.date === '${D[0]}') ctx.orderLots('AAA', 1);
          if (ctx.shares('AAA') > 0) ctx.trailingStop('AAA', 0.08);
        },
      });
    `;
    const direct = await runStrategyWithSignals({
      start: D[0],
      end: D.at(-1)!,
      initialCash: 100_000,
      strategy: await compileStrategy(code),
      dataPort: fixturePort(SPEC),
    });
    const walled = await runWalledSignalCapture(
      { code, start: D[0], end: D.at(-1)!, initialCash: 100_000 },
      fixturePort(SPEC),
    );

    expect(walled.result.tradeLog).toEqual(direct.result.tradeLog);
    expect(walled.capture).toEqual(direct.capture);
    expect(walled.capture.signals).toEqual([
      expect.objectContaining({
        code: 'AAA',
        source: 'conditional',
        orderType: 'trailing_stop',
        action: 'sell',
      }),
    ]);
  });

  it('完成周线聚合与指标在双车道一致', { timeout: 60_000 }, async () => {
    const code = `
      export default defineStrategy({
        name: 'weekly-resample-drift',
        watch: ['AAA'],
        onBar(ctx) {
          if (ctx.date !== '20240105') return;
          const weekly = ctx.weekly('AAA');
          if (weekly.sma(1) != null && weekly.highest('high', 1) != null) {
            ctx.orderLots('AAA', 1);
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

    expect(walled.tradeLog).toEqual(direct.tradeLog);
    expect(walled.nav).toEqual(direct.nav);
    expect(direct.tradeLog).toEqual([
      expect.objectContaining({ date: '20240108', code: 'AAA', side: 'buy', realShares: 100 }),
    ]);
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

  it('数值参数与单股持仓查询在进墙车道可直接用于下单', { timeout: 60_000 }, async () => {
    const direct = await runStrategy({
      start: D[0],
      end: D.at(-1)!,
      initialCash: 100_000,
      strategy: await compileStrategy(PARAMETERIZED_CODE),
      dataPort: fixturePort(SPEC),
    });
    const walled = await runWalledBacktest(
      { code: PARAMETERIZED_CODE, start: D[0], end: D.at(-1)!, initialCash: 100_000 },
      fixturePort(SPEC),
    );

    expect(walled.nav).toEqual(direct.nav);
    expect(walled.tradeLog).toEqual(direct.tradeLog);
    expect(walled.trades).toBeGreaterThan(0);
  });

  it('分类参数覆盖在直跑与进墙车道保持一致', { timeout: 60_000 }, async () => {
    const paramOverrides = { sizing: 'fixed' };
    const direct = await runStrategy({
      start: D[0],
      end: D.at(-1)!,
      initialCash: 100_000,
      strategy: await compileStrategy(
        CATEGORICAL_PARAMETER_CODE,
        undefined,
        undefined,
        paramOverrides,
      ),
      dataPort: fixturePort(SPEC),
    });
    const walled = await runWalledBacktest(
      {
        code: CATEGORICAL_PARAMETER_CODE,
        start: D[0],
        end: D.at(-1)!,
        initialCash: 100_000,
        paramOverrides,
      },
      fixturePort(SPEC),
    );

    expect(walled.nav).toEqual(direct.nav);
    expect(walled.tradeLog).toEqual(direct.tradeLog);
    expect(walled.trades).toBeGreaterThan(0);
  });

  it('Node Worker 内的进墙车道可以异步读取数据', { timeout: 60_000 }, async () => {
    const outcome = await new Promise<{
      trades?: number;
      nav?: { date: string; value: number }[];
      error?: string;
    }>((resolve, reject) => {
      const worker = new Worker(new URL('./walled-run.test-worker.mjs', import.meta.url), {
        workerData: { code: PARAMETERIZED_CODE, spec: SPEC },
      });
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`test worker exited with code ${code}`));
        }
      });
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.trades).toBeGreaterThan(0);
    expect(outcome.nav).toHaveLength(D.length);
  });
});
