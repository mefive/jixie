import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

register();
const { FactorSandbox } = await import('../factor-sandbox.ts');
const { TypeScriptTransport } = await import('#infra/sandbox/typescript/typescript-transport.js');
const variant = process.argv[2];
const scenario = process.argv[3] ?? 'cross_sectional';
if (!['before', 'shared'].includes(variant)) {
  throw new Error('Select before or shared');
}
if (!['cross_sectional', 'windowed', 'asset_series', 'logs'].includes(scenario)) {
  throw new Error('Select cross_sectional, windowed, asset_series or logs');
}
const baselineCommit = '4464a616fe5a0bc13a59379da801008e1d3823ab';
const apiDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const asset = scenario === 'asset_series';
const analysisKind = asset ? 'time_series' : 'cross_sectional';
const count = scenario === 'logs' ? 10_000 : 50_000;
const code = asset
  ? `export default defineFactorV2({
  version: 2, name: 'benchmark', analysisKind: 'time_series', outputScope: 'asset',
  frequency: 'daily', inputs: ['etf.adjustedClose'], targetAssetClasses: ['equity'], window: 20,
  compute(ctx) { return ctx.value('etf.adjustedClose') / ctx.lag('etf.adjustedClose', 19) - 1; }
});`
  : `export default defineFactor({
  name: 'benchmark', window: 20, compute(bar, ctx) {
    ${scenario === 'logs' ? "console.info('value', bar.close);" : ''}
    ${scenario === 'windowed' ? 'const values = ctx.history(20); return values[19] / values[0] - 1;' : 'return bar.close * 2;'}
  }
});`;
const input = asset
  ? {
      fields: {
        'etf.adjustedClose': Array.from({ length: count + 20 }, (_, index) => 100 + index),
      },
      indexes: Array.from({ length: count }, (_, index) => index + 19),
    }
  : {
      items: Array.from({ length: count }, (_, index) => ({
        bar: { close: 100 + index },
        ...(scenario === 'windowed'
          ? { closes: Array.from({ length: 20 }, (_, offset) => 100 + index + offset) }
          : {}),
      })),
    };
let directory;
try {
  let createSandbox = (onUserLog) =>
    FactorSandbox.start({ language: 'typescript', analysisKind, code, onUserLog });
  if (variant === 'before') {
    directory = await mkdtemp(join(apiDirectory, 'tests/.factor-runtime-benchmark-'));
    // Freeze the historical host, helper and SDK together; current module paths may move.
    const archive = execFileSync(
      'git',
      [
        'archive',
        baselineCommit,
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
    const baseline = await import(
      pathToFileURL(
        join(
          directory,
          'apps/api/src/factor/runtime/typescript',
          asset ? 'compile-asset-factor.ts' : 'compile-factor.ts',
        ),
      ).href
    );
    createSandbox = async (onUserLog) => {
      const factor = asset
        ? await baseline.compileTimeSeriesFactor(code, onUserLog)
        : await baseline.compileFactor(code, onUserLog);
      // The compatibility shape exists only in this pinned historical comparison harness.
      return {
        execute: (input) =>
          asset
            ? factor.computeSeries(input.fields, input.indexes)
            : factor.computeBatch(input.items),
        close: () => factor.dispose(),
      };
    };
  }
  let transport;
  const connect = TypeScriptTransport.connect;
  TypeScriptTransport.connect = async (options) => {
    transport = await connect.call(TypeScriptTransport, options);
    return transport;
  };
  const samples = [];
  try {
    for (let repetition = 0; repetition < 8; repetition++) {
      let logCount = 0;
      const started = performance.now();
      const sandbox = await createSandbox(() => logCount++);
      const initialized = performance.now();
      let result;
      let completed;
      try {
        result = await sandbox.execute(input);
        completed = performance.now();
        if (
          result.length !== count ||
          result.some((value) => value === null || !Number.isFinite(value))
        ) {
          throw new Error('Benchmark returned invalid scores');
        }
      } finally {
        sandbox.close();
      }
      samples.push({
        phase: repetition === 0 ? 'cold' : repetition < 3 ? 'warmup' : 'measured',
        startupMilliseconds: initialized - started,
        executionMilliseconds: completed - initialized,
        closeMilliseconds: performance.now() - completed,
        // Logical input/result bytes are comparable; shared metrics include wire envelopes and logs.
        inputBytes: Buffer.byteLength(JSON.stringify(input)),
        resultBytes: Buffer.byteLength(JSON.stringify(result)),
        transport: transport ? { ...transport.metrics } : undefined,
        logCount,
        resultHash: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
      });
    }
  } finally {
    TypeScriptTransport.connect = connect;
  }
  console.log(
    JSON.stringify({
      variant,
      scenario,
      baselineCommit,
      samples,
      maximumResidentKilobytes: process.resourceUsage().maxRSS,
    }),
  );
} finally {
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
}
