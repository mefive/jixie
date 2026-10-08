import { afterEach, describe, expect, it } from 'vitest';
import { BacktestingEngine } from '#backtesting/engine.js';
import { fixturePort } from '#backtesting/testing/fixture-port.js';
import { StrategyRuntime } from './strategy-runtime.js';

const previousPythonLocal = process.env.JIXIE_PYTHON_LOCAL;
const dates = ['20240102', '20240103'];
const spec = {
  dates,
  stocks: [{ code: 'AAA', bars: dates.map((date) => ({ date, open: 10, close: 10 })) }],
};
const sources = {
  typescript: `
let callbacks = 0;
export default defineStrategy({
  watch: ['AAA'],
  onBar(ctx) {
    callbacks++;
    console.log('session-state', callbacks, ctx.history('AAA', 'close', 100).length);
  },
});`,
  python: `
from jixie import Strategy
strategy = Strategy(watch=['AAA'])
callbacks = 0

@strategy.on_bar
def handle_bar(ctx):
    global callbacks
    callbacks += 1
    print('session-state', callbacks, len(ctx.history('AAA', 'close', 100)))
`,
};

afterEach(() => {
  if (previousPythonLocal === undefined) {
    delete process.env.JIXIE_PYTHON_LOCAL;
  } else {
    process.env.JIXIE_PYTHON_LOCAL = previousPythonLocal;
  }
});

describe.each(['typescript', 'python'] as const)('%s sandbox session state', (language) => {
  it('retains callback state and history across bars, and starts fresh in another session', async () => {
    if (language === 'python' && !process.env.JIXIE_SANDBOX_SOCKET) {
      process.env.JIXIE_PYTHON_LOCAL = '1';
    }

    const sessions: string[][] = [];

    for (let index = 0; index < 2; index++) {
      const logs: string[] = [];
      const runtime = await StrategyRuntime.start({
        language,
        code: sources[language],
        onUserLog: (_level, text) => logs.push(text),
      });

      try {
        await new BacktestingEngine({
          start: dates[0],
          end: dates[1],
          initialCash: 100_000,
          strategy: { ...runtime.metadata, onBar: (context) => runtime.execute({ context }) },
          dataPort: fixturePort(spec),
        }).run();

        sessions.push(logs.filter((line) => line.startsWith('session-state ')));
      } finally {
        runtime.close();
      }
    }

    expect(sessions).toEqual([
      ['session-state 1 1', 'session-state 2 2'],
      ['session-state 1 1', 'session-state 2 2'],
    ]);
  });
});
