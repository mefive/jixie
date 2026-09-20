import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative as relativePath } from 'node:path';
import { performance } from 'node:perf_hooks';
import { transform } from 'esbuild';
import { register } from 'tsx/esm/api';

register();
const { fixturePort } = await import('#engine/testing/fixture-port.js');
const { runStrategy } = await import('#engine/simulation/run.js');
const { createTypeScriptStrategyRuntime } = await import('./runtime.ts');
const apiDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const variant = process.argv[2];
if (!['baseline', 'before', 'shared'].includes(variant)) {
  throw new Error('Select baseline, before or shared');
}
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
    ctx.equalWeight(ranked.slice(0, 10).map(row => row.code));
  }
});`;
let directory;
try {
  let baseline;
  if (variant === 'baseline') {
    // Pin the reviewed pre-migration implementation; do not substitute a native-only baseline.
    const source = (name) =>
      execFileSync('git', ['show', `f276bfbd:apps/api/src/strategy/runtime/typescript/${name}`], {
        cwd: apiDirectory,
        encoding: 'utf8',
      });
    const entry = source('wall-entry.ts');
    let host = source('walled-run.ts');
    host = host.replace(
      "import { buildWallBundle } from './wall-bundle.js';",
      `
      import { build } from 'esbuild';
      const buildWallBundle = () => build({ stdin: { contents: ${JSON.stringify(entry)}, loader: 'ts', resolveDir: ${JSON.stringify(fileURLToPath(new URL('./', import.meta.url)))} },
        bundle: true, write: false, format: 'iife', platform: 'neutral', conditions: ['development'], target: 'es2022', mainFields: ['module', 'main'] });
      export const benchmarkMetrics = { dataCalls: 0, setupMilliseconds: 0, executionMilliseconds: 0, cleanupMilliseconds: 0 };
    `,
    );
    host = host.replace(
      'const portMethod = (',
      'benchmarkMetrics.dataCalls++; const portMethod = (',
    );
    // Instrument only the temporary old host module. Keep its original bundlePromise cache.
    const replaceOnce = (before, after) => {
      if (host.split(before).length !== 2) {
        throw new Error('Baseline instrumentation drift');
      }
      host = host.replace(before, after);
    };
    replaceOnce(
      'const userJs = await compileUserSource(cfg.code);',
      'const benchmarkStarted = performance.now(); const userJs = await compileUserSource(cfg.code);',
    );
    replaceOnce(
      "const resultJson = await context.eval('__runBacktest(__cfg)', {",
      "const executionStarted = performance.now(); benchmarkMetrics.setupMilliseconds = executionStarted - benchmarkStarted; const resultJson = await context.eval('__runBacktest(__cfg)', {",
    );
    replaceOnce(
      "if (typeof resultJson !== 'string') {\n      throw new Error('walled backtest returned a non-string result');",
      "benchmarkMetrics.executionMilliseconds = performance.now() - executionStarted; if (typeof resultJson !== 'string') {\n      throw new Error('walled backtest returned a non-string result');",
    );
    replaceOnce(
      'factorHost.close();\n    isolate.dispose();',
      'const cleanupStarted = performance.now(); factorHost.close(); isolate.dispose(); benchmarkMetrics.cleanupMilliseconds = performance.now() - cleanupStarted;',
    );
    directory = await mkdtemp(join(apiDirectory, 'tests/.runtime-benchmark-'));
    const path = join(directory, 'baseline.mjs');
    await writeFile(
      path,
      (await transform(host, { loader: 'ts', format: 'esm', target: 'es2022' })).code,
    );
    baseline = await import(pathToFileURL(path).href);
  }

  let createRuntime = createTypeScriptStrategyRuntime;
  if (variant === 'before') {
    directory = await mkdtemp(join(apiDirectory, 'tests/.runtime-benchmark-'));
    const bridgePath = join(directory, 'bridge.mjs');
    const runtimePath = join(directory, 'runtime.mjs');
    // Pin the runtime and bridge to Commit 3. Other runtime/Engine dependencies are unchanged.
    for (const [relative, output] of [
      ['../bridge.ts', bridgePath],
      ['./runtime.ts', runtimePath],
    ]) {
      const original = new URL(relative, import.meta.url);
      const repositoryPath = relativePath(apiDirectory, fileURLToPath(original));
      const source = execFileSync('git', ['show', `04f62a16:apps/api/${repositoryPath}`], {
        cwd: apiDirectory,
        encoding: 'utf8',
      }).replace(/from '([.][^']+)'/g, (_match, specifier) => {
        const target =
          specifier === '../bridge.js'
            ? pathToFileURL(bridgePath)
            : new URL(specifier.replace(/\.js$/, '.ts'), original);
        return `from ${JSON.stringify(target.href)}`;
      });
      await writeFile(
        output,
        (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code,
      );
    }
    createRuntime = (await import(pathToFileURL(runtimePath).href)).createTypeScriptStrategyRuntime;
  }

  const samples = [];
  for (let repetition = 0; repetition < (dynamic ? 8 : 13); repetition++) {
    const port = fixturePort(spec);
    const started = performance.now();
    let result;
    let metrics;
    let phases;
    if (baseline) {
      baseline.benchmarkMetrics.dataCalls = 0;
      result = await baseline.runWalledBacktest(
        { code, start: dates[0], end: dates.at(-1), initialCash: 1_000_000 },
        port,
      );
      const { dataCalls, ...timings } = baseline.benchmarkMetrics;
      metrics = { dataCalls };
      phases = timings;
    } else {
      const runtime = await createRuntime(code);
      const executionStarted = performance.now();
      let cleanupStarted;
      try {
        result = await runStrategy({
          strategy: runtime.strategy,
          start: dates[0],
          end: dates.at(-1),
          initialCash: 1_000_000,
          dataPort: port,
        });
        metrics = { ...runtime.metrics };
      } finally {
        cleanupStarted = performance.now();
        await runtime.close();
      }
      phases = {
        setupMilliseconds: executionStarted - started,
        executionMilliseconds: cleanupStarted - executionStarted,
        cleanupMilliseconds: performance.now() - cleanupStarted,
      };
    }
    samples.push({
      phase: repetition === 0 ? 'cold' : repetition < 3 ? 'warmup' : 'measured',
      milliseconds: performance.now() - started,
      ...phases,
      metrics,
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
