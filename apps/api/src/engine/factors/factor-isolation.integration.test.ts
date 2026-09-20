import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactorLanguage } from '@jixie/shared';
import { createPythonStrategyRuntime } from '#strategy/runtime/python/runtime.js';
import { runSandboxedBacktest } from '#strategy/runtime/run.js';
import { FactorHost } from '../adapters/factor-host.js';
import { runStrategy } from '../simulation/run.js';
import { fixturePort, type FixtureSpec } from '../testing/fixture-port.js';
import type { CustomFactorModule } from './custom-factor.js';
import type { EngineConfig, Strategy } from '../types.js';

const dates = ['20240102', '20240103', '20240104'];
const spec: FixtureSpec = {
  dates,
  stocks: [
    {
      code: 'A',
      bars: dates.map((date, index) => ({
        date,
        open: 10 + index,
        close: 10 + index,
        up: 20,
        down: 1,
      })),
      basic: Object.fromEntries(dates.map((date) => [date, { peTtm: 10 }])),
    },
  ],
};
const typescriptFactor: CustomFactorModule = {
  key: 'value',
  js: `
    if (typeof process !== 'undefined') throw new Error('factor initialized on host');
    module.exports = defineFactor({ name: 'value', compute(bar) {
      if (typeof process !== 'undefined') throw new Error('factor computed on host');
      return bar.peTtm == null ? null : bar.peTtm * 2;
    } });
  `,
};
const pythonFactor: CustomFactorModule = {
  key: 'value',
  language: 'python',
  runtimeVersion: 'py-v1',
  crossSectional: {},
  code: `
from jixie import Factor
factor = Factor.cross_sectional(name="value")
@factor.compute
def compute(bar, ctx):
    return None if bar.pe_ttm is None else bar.pe_ttm * 2
`,
};

async function runWithFactors(strategy: Strategy, modules: CustomFactorModule[], fixture = spec) {
  const host = new FactorHost(modules);
  try {
    return await runStrategy({
      start: dates[0],
      end: dates.at(-1)!,
      initialCash: 100_000,
      strategy,
      locale: 'en',
      customFactors: modules,
      factorExecution: host,
      dataPort: fixturePort(fixture),
    });
  } finally {
    host.close();
  }
}

function enablePython(): void {
  if (!process.env.JIXIE_SANDBOX_SOCKET) {
    vi.stubEnv('JIXIE_PYTHON_LOCAL', '1');
  }
}

describe('strategy and factor sandbox combinations', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each<[FactorLanguage, FactorLanguage]>([
    ['typescript', 'typescript'],
    ['typescript', 'python'],
    ['python', 'typescript'],
    ['python', 'python'],
  ])(
    '%s strategy consumes a sandboxed %s factor with identical fills and NAV',
    async (strategyLanguage, factorLanguage) => {
      enablePython();
      const module = factorLanguage === 'typescript' ? typescriptFactor : pythonFactor;
      const logs: string[] = [];
      const config = {
        start: dates[0],
        end: dates.at(-1)!,
        initialCash: 100_000,
        customFactors: [module],
      };
      let result;
      if (strategyLanguage === 'typescript') {
        result = await runSandboxedBacktest(
          {
            ...config,
            code: `
        export default defineStrategy({ name: 'bridge', watch: ['A'], factors: ['value'],
          async onBar(ctx) {
            await ctx.universe();
            const value = ctx.factor('value', 'A');
            console.log('value', value);
            ctx.orderTargetPercent('A', value === 20 ? 0.5 : 0);
          }
        });
      `,
          },
          fixturePort(spec),
          undefined,
          (_level, text) => logs.push(text),
        );
      } else {
        const runtime = await createPythonStrategyRuntime(
          `
from jixie import Strategy
strategy = Strategy(name="bridge", watch=["A"], factors=["value"])
@strategy.on_bar
def on_bar(ctx):
    ctx.universe()
    value = ctx.factor("value", "A")
    print("value", value)
    ctx.order_target_percent("A", 0.5 if value == 20 else 0)
`,
          (_level, text) => logs.push(text),
        );
        try {
          result = await runWithFactors(runtime.strategy, [module]);
        } finally {
          await runtime.close();
        }
      }
      const expected = await runStrategy({
        ...config,
        customFactors: [],
        dataPort: fixturePort(spec),
        strategy: {
          name: 'expected',
          watch: ['A'],
          onBar(context) {
            context.orderTargetPercent('A', 0.5);
          },
        },
      });
      expect(result.nav).toEqual(expected.nav);
      expect(result.tradeLog).toEqual(expected.tradeLog);
      expect(
        logs.filter((line) => line.startsWith('value ')).map((line) => Number(line.slice(6))),
      ).toEqual([20, 20, 20]);
    },
  );

  it('refreshes unread speculative values but retains the first value actually read that day', async () => {
    const seen: Array<number | null> = [];
    await runWithFactors(
      {
        name: 'first read',
        watch: ['A'],
        factors: ['value'],
        async onBar(context) {
          if (context.date === dates[0]) {
            seen.push(context.factor('value', 'A'));
          }
          await context.loadCrossSection();
          seen.push(context.factor('value', 'A'));
          await context.loadCrossSection();
          seen.push(context.factor('value', 'A'));
        },
      },
      [typescriptFactor],
    );
    expect(seen).toEqual([null, null, null, 20, 20, 20, 20]);
  });

  it('prepares histories after ensureBars and keeps dynamically loaded instruments available on later days', async () => {
    const seen: Array<number | null> = [];
    const module = {
      key: 'history',
      js: `module.exports = defineFactor({ name: 'history', window: 2,
      compute(bar, ctx) { const values = ctx.history(2); return values.length === 2 ? values[1] - values[0] : null; }
    });`,
    };
    await runWithFactors(
      {
        name: 'dynamic',
        factors: ['history'],
        async onBar(context) {
          if (context.date === dates[0]) {
            await context.ensureBars(['A']);
          }
          seen.push(context.factor('history', 'A'));
        },
      },
      [module],
    );
    expect(seen).toEqual([null, 1, 1]);
  });

  it('prepares dynamically acquired holdings before the next callback', async () => {
    const seen: Array<number | null> = [];
    await runWithFactors(
      {
        name: 'holding',
        factors: ['history'],
        onBar(context) {
          if (context.date === dates[0]) {
            context.order('A', 100);
          } else {
            seen.push(context.factor('history', 'A'));
          }
        },
      },
      [
        {
          key: 'history',
          js: `module.exports = defineFactor({ name: 'history', window: 1,
      compute(bar, ctx) { return ctx.history(1)[0] ?? null; }
    });`,
        },
      ],
    );
    expect(seen).toEqual([11, 12]);
  });

  it('rejects a missing execution port instead of evaluating source in the engine', async () => {
    const config: EngineConfig = {
      start: dates[0],
      end: dates[1],
      initialCash: 100_000,
      dataPort: fixturePort(spec),
      strategy: { name: 'missing host', factors: ['value'], onBar() {} },
      locale: 'en',
      customFactors: [typescriptFactor],
    };
    await expect(runStrategy(config)).rejects.toThrow('Custom Factor execution is unavailable');
  });

  it('reports an unprepared synchronous factor read instead of returning a silent missing value', async () => {
    await expect(
      runWithFactors(
        {
          name: 'unprepared',
          factors: ['value'],
          onBar(context) {
            context.factor('value', 'A');
          },
        },
        [typescriptFactor],
      ),
    ).rejects.toThrow('is not prepared');
  });

  it('combines TS and Python panel values over one frozen universe', async () => {
    enablePython();
    const fixture: FixtureSpec = {
      dates,
      stocks: ['A', 'B'].map((code, index) => ({
        code,
        assetType: 'etf',
        bars: dates.map((date) => ({ date, open: 10 + index, close: 10 + index })),
      })),
    };
    const components: CustomFactorModule[] = [
      {
        key: 'ts_component',
        analysisKind: 'panel',
        assetSeries: { window: 2, inputs: ['etf.adjustedClose'] },
        js: `module.exports = defineFactorV2({ name: 'panel', version: 2, analysisKind: 'panel',
          outputScope: 'asset', frequency: 'daily', window: 2, inputs: ['etf.adjustedClose'],
          targetAssetClasses: ['equity'], compute(ctx) { return ctx.value('etf.adjustedClose'); }
        });`,
      },
      {
        key: 'py_component',
        language: 'python',
        runtimeVersion: 'py-v1',
        analysisKind: 'panel',
        assetSeries: { window: 2, inputs: ['etf.adjustedClose'] },
        code: `
from jixie import Factor
factor = Factor.panel(name="panel", inputs=["etf.adjustedClose"], target_asset_classes=["equity"], window=2)
@factor.compute
def compute(ctx):
    return ctx.value("etf.adjustedClose")
`,
      },
    ];
    const composite: CustomFactorModule = {
      key: 'composite',
      analysisKind: 'panel',
      panelComposite: {
        standardization: 'rank',
        assetUniverse: [
          { assetId: 'A', assetClass: 'cn_equity' },
          { assetId: 'B', assetClass: 'cn_equity' },
        ],
        components: components.map((module) => ({ direction: 'positive', module })),
      },
    };
    const seen: Array<Array<number | null>> = [];
    await runWithFactors(
      {
        name: 'mixed panel',
        watch: ['A', 'B'],
        factors: ['composite'],
        onBar(context) {
          seen.push(['A', 'B'].map((code) => context.factor('composite', code)));
        },
      },
      [composite],
      fixture,
    );
    expect(seen).toEqual([
      [null, null],
      [-0.5, 0.5],
      [-0.5, 0.5],
    ]);
  });
});
