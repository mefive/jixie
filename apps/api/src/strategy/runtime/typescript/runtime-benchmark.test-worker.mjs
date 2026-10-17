import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { register } from 'tsx/esm/api';

register();
const { fixturePort } = await import('#backtesting/testing/fixture-port.js');
const { BacktestingEngine } = await import('#backtesting/backtesting-engine.js');
const { startInstrumentedStrategySandbox } = await import('./testing/sandbox.ts');
const apiDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const variant = process.argv[2];
if (!['before', 'shared'].includes(variant)) {
  throw new Error('Select before or shared');
}
// Pin the immediate pre-change runtime with the same public account contract as this fixture.
const beforeCommit = '2c58693b0768688014fce59efe65e3b794445f2d';
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
  let createSandbox = (code) => startInstrumentedStrategySandbox({ language: 'typescript', code });
  if (variant === 'before') {
    directory = await mkdtemp(join(apiDirectory, 'tests/.runtime-benchmark-'));
    // Keep the full pinned host and bundle sources together as their wire protocol evolves.
    const archive = execFileSync(
      'git',
      [
        'archive',
        beforeCommit,
        'apps/api/src',
        'apps/api/package.json',
        'apps/api/tsconfig.json',
        'tsconfig.base.json',
      ],
      { cwd: join(apiDirectory, '../..'), maxBuffer: 32 * 1024 * 1024 },
    );
    execFileSync('tar', ['-xf', '-', '-C', directory], { input: archive });
    await symlink(
      join(apiDirectory, 'node_modules'),
      join(directory, 'apps/api/node_modules'),
      'dir',
    );
    const { startInstrumentedStrategyRuntime: startBeforeRuntime } = await import(
      pathToFileURL(join(directory, 'apps/api/src/strategy/runtime/typescript/testing/runtime.ts'))
        .href
    );
    createSandbox = async (code) => {
      const { runtime: sandbox, metrics } = await startBeforeRuntime({
        language: 'typescript',
        code,
      });

      return { sandbox, metrics };
    };
  }

  const samples = [];
  for (let repetition = 0; repetition < (dynamic ? 8 : 13); repetition++) {
    const port = fixturePort(spec);
    const started = performance.now();
    const { sandbox, metrics } = await createSandbox(code);
    const executionStarted = performance.now();
    let result;
    let cleanupStarted;
    let transportMetrics;

    try {
      result = await new BacktestingEngine({
        strategy: { ...sandbox.metadata, onBar: (context) => sandbox.execute({ context }) },
        start: dates[0],
        end: dates.at(-1),
        initialCash: 1_000_000,
        dataPort: port,
      }).run();
      transportMetrics = { ...metrics };
    } finally {
      cleanupStarted = performance.now();
      sandbox.close();
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
