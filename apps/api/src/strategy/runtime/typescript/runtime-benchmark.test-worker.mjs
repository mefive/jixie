import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative as relativePath } from 'node:path';
import { performance } from 'node:perf_hooks';
import { transform } from 'esbuild';
import { register } from 'tsx/esm/api';

register();
const { fixturePort } = await import('#backtesting/testing/fixture-port.js');
const { BacktestingEngine } = await import('#backtesting/engine.js');
const { startInstrumentedStrategyRuntime } = await import('./testing/runtime.ts');
const apiDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const variant = process.argv[2];
if (!['before', 'shared'].includes(variant)) {
  throw new Error('Select before or shared');
}
// Pin the immediate pre-change runtime with the same public account contract as this fixture.
const beforeCommit = '5b92107fd9c2070b7e62315e366d05dfcd96a36c';
const sandboxDirectory = fileURLToPath(new URL('./', import.meta.url));
const bundledEntry = (entry) => `
  import { build } from 'esbuild';
  const buildStrategySandboxBundle = () => build({
    stdin: { contents: ${JSON.stringify(entry)}, loader: 'ts', resolveDir: ${JSON.stringify(sandboxDirectory)} },
    bundle: true, write: false, format: 'iife', platform: 'neutral', conditions: ['development'],
    target: 'es2022', mainFields: ['module', 'main']
  });
`;
const scenario = process.argv[3] ?? 'watch';
if (!['watch', 'dynamic'].includes(scenario)) {
  throw new Error('Select watch or dynamic');
}
const dynamic = scenario === 'dynamic';

const dates = Array.from({ length: dynamic ? 252 : 120 }, (_, index) => {
  const date = new Date(Date.UTC(2024, 0, 1 + index));
  return date.toISOString().slice(0, 10).replaceAll('-', '');
});
const codes = Array.from({ length: dynamic ? 300 : 100 }, (_, index) => `ASSET${index}`);
const spec = {
  dates,
  stocks: codes.map((code, asset) => ({
    code,
    bars: dates.map((date, index) => ({
      date,
      open: 10 + asset + index * 0.01,
      close: 10.1 + asset + index * 0.01,
      up: 1_000,
      down: 1,
      amount: 100_000,
    })),
  })),
};
const code = `let cursor = 0;
const all = ${JSON.stringify(codes)};
export default defineStrategy({
  name: 'runtime-benchmark', watch: ${dynamic ? '[]' : JSON.stringify(codes)},
  async onBar(ctx) {
    await ctx.universe();
    const selected = ${dynamic ? 'Array.from({ length: 50 }, (_, index) => all[(cursor + index) % all.length])' : 'all'};
    ${dynamic ? 'cursor += 20; await ctx.ensureBars(selected);' : ''}
    const ranked = selected.map(code => ({ code, score: ctx.sma(code, ${dynamic ? 20 : 5}) }));
    ranked.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
    ctx.stock.equalWeight(ranked.slice(0, 10).map(row => row.code));
  }
});`;
let directory;
try {
  let createRuntime = (code) => startInstrumentedStrategyRuntime({ language: 'typescript', code });
  if (variant === 'before') {
    directory = await mkdtemp(join(apiDirectory, 'tests/.runtime-benchmark-'));
    const bridgePath = join(directory, 'bridge.mjs');
    const runtimePath = join(directory, 'runtime.mjs');
    const historicalSource = (repositoryPath) =>
      execFileSync('git', ['show', `${beforeCommit}:${repositoryPath}`], {
        cwd: apiDirectory,
        encoding: 'utf8',
      });
    const entry = historicalSource('apps/api/src/strategy/runtime/typescript/sandbox-entry.ts');

    for (const [relative, output] of [
      ['../bridge.ts', bridgePath],
      ['./typescript-strategy-runtime.ts', runtimePath],
    ]) {
      const original = new URL(relative, import.meta.url);
      const repositoryPath = relativePath(apiDirectory, fileURLToPath(original));
      let source = historicalSource(`apps/api/${repositoryPath}`).replace(
        /from '([.][^']+)'/g,
        (_match, specifier) => {
          const target =
            specifier === '../bridge.js'
              ? pathToFileURL(bridgePath)
              : new URL(specifier.replace(/\.js$/, '.ts'), original);
          return `from ${JSON.stringify(target.href)}`;
        },
      );
      if (output === runtimePath) {
        const bundleImport = `import { buildStrategySandboxBundle } from ${JSON.stringify(new URL('./sandbox-bundle.ts', original).href)};`;
        if (!source.includes(bundleImport)) {
          throw new Error('Historical bundle import drift');
        }
        source = source.replace(bundleImport, bundledEntry(entry));
      }
      await writeFile(
        output,
        (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code,
      );
    }
    const { TypeScriptStrategyRuntime } = await import(pathToFileURL(runtimePath).href);
    createRuntime = async (code) => {
      const runtime = await TypeScriptStrategyRuntime.start({ language: 'typescript', code });
      return { runtime, metrics: runtime.metrics };
    };
  }

  const samples = [];
  for (let repetition = 0; repetition < (dynamic ? 8 : 13); repetition++) {
    const port = fixturePort(spec);
    const started = performance.now();
    const { runtime, metrics } = await createRuntime(code);
    const executionStarted = performance.now();
    let result;
    let cleanupStarted;
    let transportMetrics;

    try {
      result = await new BacktestingEngine({
        strategy: { ...runtime.metadata, onBar: (context) => runtime.execute({ context }) },
        start: dates[0],
        end: dates.at(-1),
        initialCash: 1_000_000,
        dataPort: port,
      }).run();
      transportMetrics = { ...metrics };
    } finally {
      cleanupStarted = performance.now();
      runtime.close();
    }
    const phases = {
      setupMilliseconds: executionStarted - started,
      executionMilliseconds: cleanupStarted - executionStarted,
      cleanupMilliseconds: performance.now() - cleanupStarted,
    };

    samples.push({
      phase: repetition === 0 ? 'cold' : repetition < 3 ? 'warmup' : 'measured',
      milliseconds: performance.now() - started,
      ...phases,
      metrics: transportMetrics,
      resultHash: createHash('sha256')
        .update(JSON.stringify({ nav: result.nav, trades: result.tradeLog }))
        .digest('hex'),
    });
  }
  console.log(
    JSON.stringify({
      variant,
      scenario,
      samples,
      maximumResidentKilobytes: process.resourceUsage().maxRSS,
    }),
  );
} finally {
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
}
