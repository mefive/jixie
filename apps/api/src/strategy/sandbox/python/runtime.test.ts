import { StrategySandbox } from '../strategy-sandbox.js';
import { afterEach, describe, expect, it } from 'vitest';
import { fixturePort, type FixtureSpec } from '#backtesting/testing/fixture-port.js';
import { BacktestingEngine } from '#backtesting/backtesting-engine.js';
import { defineStrategy } from '../../sdk/typescript.js';
import { createFixtureEngineStrategy } from '../typescript/testing/compile.js';

const dates = ['20240101', '20240102', '20240103', '20240104', '20240105', '20240108'];
const spec: FixtureSpec = {
  dates,
  stocks: [
    {
      code: 'AAA',
      bars: dates.map((date, index) => ({
        date,
        open: 10 + index * 0.3,
        close: 10.2 + index * 0.3,
        up: 20,
        down: 5,
        amount: 5_000,
      })),
    },
    {
      code: 'BBB',
      bars: dates.map((date, index) => ({
        date,
        open: 50 - index,
        close: 49.5 - index,
        up: 60,
        down: 30,
        amount: 8_000,
      })),
    },
  ],
};

const pythonCode = `
from jixie import Strategy

strategy = Strategy(name="python-drift", watch=["AAA", "BBB"])

@strategy.on_bar
def handle_bar(ctx):
    if ctx.date == "20240101":
        assert ctx.sma("AAA", 1) is not None
        assert ctx.history("AAA", "adj_close", 1) == ctx.history("AAA", "close", 1)
        ctx.stock.set_target_weights({"AAA": 0.4, "BBB": 0.4})
    if ctx.date == "20240103":
        ctx.stock.close_position("BBB")
    if ctx.date == "20240105":
        ctx.stock.close_position("AAA")
    print("bar", ctx.date, round(ctx.portfolio.equity))
`;

describe('Python strategy runtime', () => {
  it('ignores legacy futures declarations while retaining the cash default', async () => {
    enableTestRuntime();
    const sandbox = await StrategySandbox.start({
      language: 'python',
      code: pythonCode.replace('watch=["AAA", "BBB"]', 'watch=["AAA", "BBB"], futures=["UNKNOWN"]'),
    });
    try {
      expect(sandbox.metadata.futures).toEqual([]);
      expect(sandbox.metadata.accounts).toBeUndefined();
    } finally {
      sandbox.close();
    }
  });

  it('rejects futures capital without relying on a declaration', async () => {
    enableTestRuntime();
    await expect(
      StrategySandbox.start({
        language: 'python',
        code: pythonCode.replace(
          'watch=["AAA", "BBB"]',
          'accounts={"stock": {"cashWeight": 0.5}, "futures": {"cashWeight": 0.5}}',
        ),
      }),
    ).rejects.toThrow('supports stock and ETF strategies only');
  });

  afterEach(() => {
    delete process.env.JIXIE_PYTHON_LOCAL;
    delete process.env.JIXIE_PYTHON_CODE_TIMEOUT_SECONDS;
  });

  it('keeps fills and NAV identical to a native strategy over the same engine', async () => {
    enableTestRuntime();
    const logs: string[] = [];
    const sandbox = await StrategySandbox.start({
      language: 'python',
      code: pythonCode,
      onUserLog: (_level, text) => logs.push(text),
    });
    const nativeStrategy = defineStrategy({
      name: 'native-drift',
      watch: ['AAA', 'BBB'],
      onBar(context) {
        if (context.date === '20240101') {
          context.stock.setTargetWeights({ AAA: 0.4, BBB: 0.4 });
        }
        if (context.date === '20240103') {
          context.stock.closePosition('BBB');
        }
        if (context.date === '20240105') {
          context.stock.closePosition('AAA');
        }
      },
    });
    try {
      const [pythonResult, nativeResult] = await Promise.all([
        new BacktestingEngine({
          start: dates[0],
          end: dates.at(-1)!,
          initialCash: 100_000,
          strategy: { ...sandbox.metadata, onBar: (context) => sandbox.execute({ context }) },
          dataPort: fixturePort(spec),
        }).run(),
        new BacktestingEngine({
          start: dates[0],
          end: dates.at(-1)!,
          initialCash: 100_000,
          strategy: createFixtureEngineStrategy(nativeStrategy),
          dataPort: fixturePort(spec),
        }).run(),
      ]);

      expect(pythonResult.nav).toEqual(nativeResult.nav);
      expect(pythonResult.tradeLog).toEqual(nativeResult.tradeLog);
      expect(logs).toHaveLength(dates.length);
      expect(sandbox.metadata.name).toBe('python-drift');
    } finally {
      sandbox.close();
    }
  });

  it('matches TypeScript command rejection, catch-and-recover behavior and resulting trades', async () => {
    enableTestRuntime();
    const sources = {
      typescript: `export default defineStrategy({ name: 'command-recovery', watch: ['AAA'], onBar(ctx) {
        if (ctx.date !== '20240101') return;
        let rejected = 0;
        try { ctx.stock.setTargetWeight('AAA', 1.2); } catch { rejected++; }
        try { ctx.stock.stopLossAtAdjustedPrice('AAA', -1); } catch { rejected++; }
        try { ctx.stock.setTargetWeight('AAA', 'invalid' as unknown as number); } catch { rejected++; }
        try { ctx.stock.orderLots('AAA', NaN); } catch { rejected++; }
        if (rejected !== 4) throw new Error('command errors did not return to the call site');
        ctx.stock.setTargetWeight('AAA', 0.5);
        console.log('command-recovery', rejected);
      } });`,
      python: `
from jixie import Strategy
strategy = Strategy(name="command-recovery", watch=["AAA"])

@strategy.on_bar
def handle_bar(ctx):
    if ctx.date != "20240101":
        return
    rejected = 0
    try:
        ctx.stock.set_target_weight("AAA", 1.2)
    except RuntimeError:
        rejected += 1
    try:
        ctx.stock.stop_loss_at_adjusted_price("AAA", -1)
    except RuntimeError:
        rejected += 1
    try:
        ctx.stock.set_target_weight("AAA", "invalid")
    except RuntimeError:
        rejected += 1
    try:
        ctx.stock.order_lots("AAA", float("nan"))
    except ValueError:
        rejected += 1
    assert rejected == 4, "command errors did not return to the call site"
    ctx.stock.set_target_weight("AAA", 0.5)
    print("command-recovery", rejected)
`,
    };
    const results = [];

    for (const language of ['typescript', 'python'] as const) {
      const logs: string[] = [];
      const sandbox = await StrategySandbox.start({
        language,
        code: sources[language],
        onUserLog: (_level, text) => logs.push(text),
      });

      try {
        results.push(
          await new BacktestingEngine({
            start: dates[0],
            end: dates.at(-1)!,
            initialCash: 100_000,
            strategy: { ...sandbox.metadata, onBar: (context) => sandbox.execute({ context }) },
            dataPort: fixturePort(spec),
          }).run(),
        );
        expect(logs).toEqual(['command-recovery 4']);
      } finally {
        sandbox.close();
      }
    }

    expect(results[0].tradeLog).toHaveLength(1);
    expect(results[1].tradeLog).toEqual(results[0].tradeLog);
    expect(results[1].nav).toEqual(results[0].nav);
  });

  it('keeps Python daily technical indicators aligned with the TypeScript SDK', async () => {
    enableTestRuntime();
    const logs: string[] = [];
    const sandbox = await StrategySandbox.start({
      language: 'python',
      code: `
from jixie import Strategy

strategy = Strategy(name="python-indicators", watch=["AAA"])

@strategy.on_bar
def handle_bar(ctx):
    if ctx.date != "20240108":
        return
    bands = ctx.bollinger_bands("AAA", 3, 2)
    directional = ctx.adx("AAA", 2)
    convergence = ctx.macd("AAA", 1, 2, 2)
    stochastic = ctx.kdj("AAA", 3)
    values = [
        bands.middle, bands.upper, bands.lower,
        ctx.rsi("AAA", 2),
        directional.adx, directional.positive_di, directional.negative_di,
        convergence.line, convergence.signal, convergence.histogram,
        stochastic.k, stochastic.d, stochastic.j,
    ]
    print("indicator-probe", *values)
`,
      onUserLog: (_level, text) => logs.push(text),
    });
    let nativeValues: number[] = [];
    const nativeStrategy = defineStrategy({
      name: 'native-indicators',
      watch: ['AAA'],
      onBar(context) {
        if (context.date !== '20240108') {
          return;
        }
        const bands = context.bollingerBands('AAA', 3, 2)!;
        const directional = context.adx('AAA', 2)!;
        const convergence = context.macd('AAA', 1, 2, 2)!;
        const stochastic = context.kdj('AAA', 3)!;
        nativeValues = [
          bands.middle,
          bands.upper,
          bands.lower,
          context.rsi('AAA', 2)!,
          directional.adx,
          directional.positiveDi,
          directional.negativeDi,
          convergence.line,
          convergence.signal,
          convergence.histogram,
          stochastic.k,
          stochastic.d,
          stochastic.j,
        ];
      },
    });

    try {
      await Promise.all([
        new BacktestingEngine({
          start: dates[0],
          end: dates.at(-1)!,
          initialCash: 100_000,
          strategy: { ...sandbox.metadata, onBar: (context) => sandbox.execute({ context }) },
          dataPort: fixturePort(spec),
        }).run(),
        new BacktestingEngine({
          start: dates[0],
          end: dates.at(-1)!,
          initialCash: 100_000,
          strategy: createFixtureEngineStrategy(nativeStrategy),
          dataPort: fixturePort(spec),
        }).run(),
      ]);

      const probe = logs.find((line) => line.startsWith('indicator-probe '));
      const pythonValues = probe?.split(' ').slice(1).map(Number) ?? [];
      expect(pythonValues).toHaveLength(nativeValues.length);
      pythonValues.forEach((value, index) => expect(value).toBeCloseTo(nativeValues[index], 10));
    } finally {
      sandbox.close();
    }
  });

  it('returns Python tracebacks with strategy.py line numbers', async () => {
    enableTestRuntime();
    const sandbox = await StrategySandbox.start({
      language: 'python',
      code: `
from jixie import Strategy
strategy = Strategy()
@strategy.on_bar
def broken(ctx):
    raise ValueError("boom")
`,
    });
    try {
      await expect(
        new BacktestingEngine({
          start: dates[0],
          end: dates[1],
          initialCash: 100_000,
          strategy: { ...sandbox.metadata, onBar: (context) => sandbox.execute({ context }) },
          dataPort: fixturePort(spec),
        }).run(),
      ).rejects.toThrow(/strategy\.py.*ValueError: boom/s);
    } finally {
      sandbox.close();
    }
  });

  it('allows published Factor keys to flow through the shared engine host', async () => {
    enableTestRuntime();
    const sandbox = await StrategySandbox.start({
      language: 'python',
      code: `
from jixie import Strategy
strategy = Strategy(factors=["python_value"])
@strategy.on_bar
def handle_bar(ctx):
    pass
`,
    });
    try {
      expect(sandbox.metadata.factors).toEqual(['python_value']);
    } finally {
      sandbox.close();
    }
  });

  it.skipIf(
    Boolean(process.env.JIXIE_SANDBOX_SOCKET) && process.env.JIXIE_TEST_PYTHON_TIMEOUT !== '1',
  )('interrupts user-code loops instead of hanging the worker', async () => {
    enableTestRuntime();
    if (!process.env.JIXIE_SANDBOX_SOCKET) {
      process.env.JIXIE_PYTHON_CODE_TIMEOUT_SECONDS = '0.05';
    }
    await expect(
      StrategySandbox.start({
        language: 'python',
        code: `
from jixie import Strategy
while True:
    pass
strategy = Strategy()
@strategy.on_bar
def handle_bar(ctx):
    pass
`,
      }),
    ).rejects.toThrow(/TimeoutError: Python strategy exceeded 0\.05s/s);
  });
});

function enableTestRuntime(): void {
  if (!process.env.JIXIE_SANDBOX_SOCKET) {
    process.env.JIXIE_PYTHON_LOCAL = '1';
  }
}
