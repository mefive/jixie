import { describe, expect, it, vi } from 'vitest';
import { inspectStrategyParameters } from './inspect-parameters.js';
import { inspectStrategyScanParameters } from './parameters.js';

// Loading any execution infrastructure makes this static-only suite fail immediately.
vi.mock('../runtime/strategy-runtime.js', () => {
  throw new Error('Static inspection must not load StrategyRuntime');
});
vi.mock('#infra/runtime/typescript/transport.js', () => {
  throw new Error('Static inspection must not load the isolate transport');
});

const fields = `params: { lookback: 20, threshold: -0.25, fraction: .1, positive: +2,
  sizing: 'equal', "label": "a\\nb", template: \`fixed\`, exponent: 1e2, hex: 0x10,
  separator: 1_000, 'negative-zero': -0 }, onBar() {}`;
const expected = {
  lookback: 20,
  threshold: -0.25,
  fraction: 0.1,
  positive: 2,
  sizing: 'equal',
  label: 'a\nb',
  template: 'fixed',
  exponent: 100,
  hex: 16,
  separator: 1000,
  'negative-zero': -0,
};

describe('static strategy parameter inspection', () => {
  it.each([
    `export default defineStrategy({ ${fields} });`,
    `export default ({ ${fields} });`,
    `const strategy = defineStrategy({ ${fields} }); export default strategy;`,
    `const strategy = ({ ${fields} } as const); export default strategy;`,
    `export default (defineStrategy(({ ${fields} } satisfies CodeStrategy)) as CodeStrategy);`,
    `export default <CodeStrategy>({ ${fields} });`,
  ])('reads supported declarations: %s', async (code) => {
    expect(await inspectStrategyParameters(code)).toEqual(expected);
  });

  it.each([
    `const strategy = defineStrategy({ params: { strategy: 20 }, onBar() {} });
      export default strategy;`,
    `const strategy = defineStrategy({ params: { strategy: 20 },
      onBar(ctx) { const strategy = 1; void strategy; } }); export default strategy;`,
    `const strategy = defineStrategy({ params: { strategy: 20 },
      onBar(strategy) { void strategy; } }); export default strategy;`,
    `const strategy = defineStrategy({ params: { strategy: 20 },
      onBar(ctx) { const { strategy } = ctx.params; void strategy; } }); export default strategy;`,
    `const strategy = defineStrategy({ params: { strategy: 20 },
      onBar(ctx) { void ctx.params.strategy; } }); export default strategy;`,
    `const unrelated = { strategy: 1, defineStrategy() {} };
      const strategy = defineStrategy({ params: { strategy: 20 }, onBar() {} });
      export default strategy;`,
    `function helper(defineStrategy) { return defineStrategy({}); }
      export default defineStrategy({ params: { strategy: 20 }, onBar() {} });`,
    `export default defineStrategy({ params: { strategy: 20 },
      onBar(ctx) { const defineStrategy = () => 1; defineStrategy(); } });`,
  ])(
    'distinguishes property names and local bindings from strategy references: %s',
    async (code) => {
      expect(await inspectStrategyParameters(code)).toEqual({ strategy: 20 });
    },
  );

  it('allows a parameter key named defineStrategy', async () => {
    expect(
      await inspectStrategyParameters(`export default defineStrategy({
      params: { defineStrategy: 'equal' }, onBar() {}
    });`),
    ).toEqual({ defineStrategy: 'equal' });
  });

  it.each([
    'const escaped = { strategy };',
    'export { strategy };',
    'export { strategy as anotherStrategy };',
    'const alias = strategy;',
    'const callback = () => strategy;',
    'Object.assign(strategy, { params: { lookback: 99 } });',
  ])('continues rejecting actual references to the exported strategy: %s', async (reference) => {
    const code = `const strategy = defineStrategy({ params: { lookback: 20 }, onBar() {} });
      ${reference} export default strategy;`;
    await expect(inspectStrategyParameters(code)).rejects.toMatchObject({
      reason: 'strategy_scan_params_not_static',
      details: { field: 'export default' },
    });
  });

  it.each([
    'function defineStrategy(value) { return value; }',
    'const { defineStrategy } = other;',
    'import { defineStrategy } from "custom-sdk";',
    'import { factory as defineStrategy } from "custom-sdk";',
    'defineStrategy = replacement;',
    'const escaped = { defineStrategy };',
    'export { defineStrategy as anotherFactory };',
  ])('continues rejecting SDK factory replacements and escapes: %s', async (statement) => {
    await expect(
      inspectStrategyParameters(`${statement}
      export default defineStrategy({ params: { lookback: 20 }, onBar() {} });`),
    ).rejects.toMatchObject({ reason: 'strategy_scan_params_not_static' });
  });

  it.each(['', 'params: {},', 'name: makeName(), watch: loadWatch(),'])(
    'returns empty defaults when params is absent or empty: %s',
    async (fields) => {
      expect(
        await inspectStrategyParameters(`export default defineStrategy({ ${fields} onBar() {} });`),
      ).toEqual({});
    },
  );

  it('ignores decoys and never executes top-level code, other metadata or callbacks', async () => {
    const code = `
      throw new Error('Top-level code must not execute');
      globalThis.__strategyInspectionExecuted = true;
      const decoy = { params: { wrong: 99 } };
      // params: { wrong: 42 }
      export default defineStrategy({
        name: (() => { throw new Error('metadata must not execute'); })(),
        params: { correct: (-(0.5) as number), mode: ('fixed' as const) },
        onBar() { throw new Error('callback must not execute'); }
      });`;
    expect(await inspectStrategyScanParameters({ code, language: 'typescript' })).toEqual({
      parameters: { correct: -0.5, mode: 'fixed' },
    });
    expect(Reflect.has(globalThis, '__strategyInspectionExecuted')).toBe(false);
  });

  it.each([
    'true',
    'false',
    'null',
    'undefined',
    'NaN',
    'Infinity',
    '1e999',
    '1n',
    '[]',
    '{}',
    '""',
    '"   "',
    JSON.stringify('a'.repeat(101)),
    '10 + 10',
    'Math.random()',
    'lookback',
    '`window-${20}`',
    '() => 20',
  ])('rejects invalid or dynamic parameter values: %s', async (value) => {
    await expect(
      inspectStrategyParameters(
        `export default defineStrategy({ params: { lookback: ${value} } });`,
      ),
    ).rejects.toMatchObject({
      reason: 'strategy_scan_params_not_static',
      details: { field: 'params.lookback' },
    });
  });

  it.each([
    '__proto__: { params: { hidden: 1 } }',
    'params: defaults',
    'params: loadDefaults()',
    'params: null',
    'params: undefined',
    'params: []',
    'params',
    'get params() { return {}; }',
    'params() { return {}; }',
    'params: { ...defaults }',
    'params: { lookback }',
    'params: { [key]: 20 }',
    'params: { ["lookback"]: 20 }',
    'params: { get lookback() { return 20; } }',
    'params: { lookback: 10, "lookback": 20 }',
    'params: { " ": 20 }',
    'params: { __proto__: 20 }',
    'params: {}, params: {}',
    '...other',
    'params: { lookback: 20 }, ...other',
    '[key]: 20',
  ])('rejects ambiguous params declarations: %s', async (fields) => {
    await expect(
      inspectStrategyParameters(`export default defineStrategy({ ${fields} });`),
    ).rejects.toMatchObject({ reason: 'strategy_scan_params_not_static' });
  });

  it.each([
    'export default {}; export { other as default };',
    'const value = 1;',
    'export default makeStrategy();',
    'export default defineStrategy(options);',
    'export default defineStrategy({}, {});',
    'export default defineStrategy({ params: { broken: } });',
    'let strategy = defineStrategy({}); export default strategy;',
    'const strategy = defineStrategy({}); strategy.params = { hidden: 1 }; export default strategy;',
    'const strategy = defineStrategy({}); mutate(strategy); export default strategy;',
    'const defineStrategy = () => ({}); export default defineStrategy({});',
    'export default condition ? defineStrategy({}) : defineStrategy({});',
    'export = defineStrategy({});',
  ])('rejects unsupported strategy declarations: %s', async (code) => {
    await expect(inspectStrategyParameters(code)).rejects.toMatchObject({
      reason: 'strategy_scan_params_not_static',
    });
  });

  it('preserves the existing parameter count and key length limits', async () => {
    for (const params of [
      Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`key${index}`, index])),
      { ['a'.repeat(257)]: 1 },
    ]) {
      await expect(
        inspectStrategyParameters(`export default { params: ${JSON.stringify(params)} };`),
      ).rejects.toMatchObject({ reason: 'strategy_scan_params_not_static' });
    }
  });

  it('keeps Python scanning unsupported', async () => {
    await expect(
      inspectStrategyScanParameters({ language: 'python', code: 'raise Exception()' }),
    ).rejects.toMatchObject({ reason: 'strategy_python_scan_unsupported' });
  });
});
