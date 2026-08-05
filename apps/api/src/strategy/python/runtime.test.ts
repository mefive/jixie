import { afterEach, describe, expect, it } from 'vitest';
import { fixturePort, type FixtureSpec } from '../../engine/fixture-port.js';
import { runStrategy } from '../../engine/run.js';
import { defineStrategy } from '../code/sdk.js';
import { createPythonStrategyRuntime } from './runtime.js';

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
        ctx.set_holdings({"AAA": 0.4, "BBB": 0.4})
    if ctx.date == "20240103":
        ctx.exit("BBB")
    if ctx.date == "20240105":
        ctx.exit("AAA")
    print("bar", ctx.date, round(ctx.value))
`;

describe('Python strategy runtime', () => {
  afterEach(() => {
    delete process.env.JIXIE_PYTHON_LOCAL;
    delete process.env.JIXIE_PYTHON_CODE_TIMEOUT_SECONDS;
  });

  it('keeps fills and NAV identical to a native strategy over the same engine', async () => {
    enableTestRuntime();
    const logs: string[] = [];
    const runtime = await createPythonStrategyRuntime(pythonCode, (_level, text) =>
      logs.push(text),
    );
    const nativeStrategy = defineStrategy({
      name: 'native-drift',
      watch: ['AAA', 'BBB'],
      onBar(context) {
        if (context.date === '20240101') {
          context.setHoldings({ AAA: 0.4, BBB: 0.4 });
        }
        if (context.date === '20240103') {
          context.exit('BBB');
        }
        if (context.date === '20240105') {
          context.exit('AAA');
        }
      },
    });
    try {
      const [pythonResult, nativeResult] = await Promise.all([
        runStrategy({
          start: dates[0],
          end: dates.at(-1)!,
          initialCash: 100_000,
          strategy: runtime.strategy,
          dataPort: fixturePort(spec),
        }),
        runStrategy({
          start: dates[0],
          end: dates.at(-1)!,
          initialCash: 100_000,
          strategy: nativeStrategy,
          dataPort: fixturePort(spec),
        }),
      ]);

      expect(pythonResult.nav).toEqual(nativeResult.nav);
      expect(pythonResult.tradeLog).toEqual(nativeResult.tradeLog);
      expect(logs).toHaveLength(dates.length);
      expect(runtime.strategy.name).toBe('python-drift');
    } finally {
      await runtime.close();
    }
  });

  it('returns Python tracebacks with strategy.py line numbers', async () => {
    enableTestRuntime();
    const runtime = await createPythonStrategyRuntime(`
from jixie import Strategy
strategy = Strategy()
@strategy.on_bar
def broken(ctx):
    raise ValueError("boom")
`);
    try {
      await expect(
        runStrategy({
          start: dates[0],
          end: dates[1],
          initialCash: 100_000,
          strategy: runtime.strategy,
          dataPort: fixturePort(spec),
        }),
      ).rejects.toThrow(/strategy\.py.*ValueError: boom/s);
    } finally {
      await runtime.close();
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
      createPythonStrategyRuntime(`
from jixie import Strategy
while True:
    pass
strategy = Strategy()
@strategy.on_bar
def handle_bar(ctx):
    pass
`),
    ).rejects.toThrow(/TimeoutError: Python strategy exceeded 0\.05s/s);
  });
});

function enableTestRuntime(): void {
  if (!process.env.JIXIE_SANDBOX_SOCKET) {
    process.env.JIXIE_PYTHON_LOCAL = '1';
  }
}
