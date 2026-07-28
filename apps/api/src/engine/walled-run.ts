import { fileURLToPath } from 'node:url';
import ivm from 'isolated-vm';
import { build, transform } from 'esbuild';
import type { Locale, StrategySignalMetadata } from '@jixie/shared';
import type { EngineDataPort } from './data-port.js';
import type { CustomFactorModule } from './custom-factor.js';
import type { BacktestResult, CostModel, SignalBacktestOutput } from './types.js';
import type { UserLogSink } from '../lib/sandbox-console.js';

/**
 * The walled lane's HOST side (sandbox Phase B2): bundle the engine (wall-entry.ts) once, evaluate
 * it inside an isolated-vm isolate, and serve its DataPort crossings with a host-side port
 * (prismaDataPort in production; a fixture port in the drift test). Lane rule (定死,
 * python-and-sandbox.md): code from the DB (user/AI authored) runs here; repo-checked-in code may
 * use the direct lane (runCodeBacktest) — the switch follows the CODE'S ORIGIN, not the caller.
 */

const WALL_MEMORY_MB = 1024; // engine caches (bars for hundreds of stocks) live in-wall
const WALL_TIMEOUT_MS = 3_600_000; // generous — legitimate runs take minutes; the worker can kill us anyway

// The engine bundle is content-static per process — build once, reuse across runs.
let bundlePromise: Promise<string> | null = null;
function wallBundle(): Promise<string> {
  bundlePromise ??= (async () => {
    const entry = new URL(
      import.meta.url.endsWith('.ts') ? './wall-entry.ts' : './wall-entry.js',
      import.meta.url,
    );
    const result = await build({
      entryPoints: [fileURLToPath(entry)],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'neutral',
      target: 'es2022',
      mainFields: ['module', 'main'],
      plugins: [
        {
          // Nothing inside the wall may pull in Prisma: run.ts default-imports prisma-port for the
          // direct lane — alias it to a stub (wall-entry always injects the bridge port).
          name: 'stub-prisma-port',
          setup(pluginBuild) {
            pluginBuild.onResolve({ filter: /prisma-port(\.js)?$/ }, (args) => ({
              path: args.path,
              namespace: 'prisma-port-stub',
            }));
            pluginBuild.onLoad({ filter: /.*/, namespace: 'prisma-port-stub' }, () => ({
              contents: `export const prismaDataPort = new Proxy({}, {
                get() { throw new Error('prismaDataPort is not available inside the wall'); },
              });`,
              loader: 'js',
            }));
          },
        },
      ],
    });
    return result.outputFiles[0].text;
  })();
  return bundlePromise;
}

export interface WalledBacktestConfig {
  code: string; // user-authored TypeScript strategy module (DB origin)
  start: string;
  end: string;
  initialCash: number;
  cost?: Partial<CostModel>;
  locale?: Locale;
  /** Referenced custom factors, host-prepared (ownership-checked + TS→CJS) — evaluated in-wall. */
  customFactors?: CustomFactorModule[];
  /** Numeric overrides merged into the strategy's declared params inside the isolate. */
  paramOverrides?: Record<string, number>;
}

async function compileUserSource(code: string): Promise<string> {
  try {
    return (
      await transform(code, {
        loader: 'ts',
        format: 'cjs',
        target: 'es2022',
      })
    ).code;
  } catch (error) {
    throw new Error(
      `strategy code compilation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Evaluate only the strategy declaration inside the hard sandbox and return its numeric defaults. */
export async function inspectWalledStrategyParameters(
  code: string,
): Promise<Record<string, number>> {
  const userJs = await compileUserSource(code);
  const isolate = new ivm.Isolate({ memoryLimit: 128 });
  try {
    const context = await isolate.createContext();
    await context.global.set(
      '__hostFetch',
      new ivm.Reference(() => {
        throw new Error('market data is unavailable while inspecting strategy parameters');
      }),
    );
    await context.global.set('__hostLog', new ivm.Reference(() => {}));
    await context.eval(await wallBundle(), { timeout: 60_000 });
    await context.global.set('__userJs', new ivm.ExternalCopy(userJs).copyInto({ release: true }));
    const resultJson = await context.eval('__inspectStrategyParameters(__userJs)', {
      timeout: 5_000,
      copy: true,
    });
    if (typeof resultJson !== 'string') {
      throw new Error('strategy parameter inspection returned a non-string result');
    }
    return JSON.parse(resultJson) as Record<string, number>;
  } finally {
    isolate.dispose();
  }
}

/** Safely inspect the declaration fields needed for deployment eligibility and data synchronization. */
export async function inspectWalledStrategyMetadata(code: string): Promise<StrategySignalMetadata> {
  const userJs = await compileUserSource(code);
  const isolate = new ivm.Isolate({ memoryLimit: 128 });
  try {
    const context = await isolate.createContext();
    await context.global.set(
      '__hostFetch',
      new ivm.Reference(() => {
        throw new Error('market data is unavailable while inspecting strategy metadata');
      }),
    );
    await context.global.set('__hostLog', new ivm.Reference(() => {}));
    await context.eval(await wallBundle(), { timeout: 60_000 });
    await context.global.set('__userJs', new ivm.ExternalCopy(userJs).copyInto({ release: true }));
    const resultJson = await context.eval('__inspectStrategyMetadata(__userJs)', {
      timeout: 5_000,
      copy: true,
    });
    if (typeof resultJson !== 'string') {
      throw new Error('strategy metadata inspection returned a non-string result');
    }
    return JSON.parse(resultJson) as StrategySignalMetadata;
  } finally {
    isolate.dispose();
  }
}

/**
 * Run one backtest on the walled lane. `port` is the host-side data source the wall's crossings
 * are served from (prismaDataPort in production, fixturePort in tests).
 */
export async function runWalledBacktest(
  cfg: WalledBacktestConfig,
  port: EngineDataPort,
  onLog?: (line: string) => void,
  onUserLog?: UserLogSink,
): Promise<BacktestResult> {
  return runWalled(cfg, port, false, onLog, onUserLog) as Promise<BacktestResult>;
}

/** Run a stock/ETF deployment and return both its backtest and final next-open intent. */
export async function runWalledSignalCapture(
  cfg: WalledBacktestConfig,
  port: EngineDataPort,
  onLog?: (line: string) => void,
  onUserLog?: UserLogSink,
): Promise<SignalBacktestOutput> {
  return runWalled(cfg, port, true, onLog, onUserLog) as Promise<SignalBacktestOutput>;
}

async function runWalled(
  cfg: WalledBacktestConfig,
  port: EngineDataPort,
  captureSignals: boolean,
  onLog?: (line: string) => void,
  onUserLog?: UserLogSink,
): Promise<BacktestResult | SignalBacktestOutput> {
  // TS → CJS on the host (esbuild can't run in-wall); the module evaluates inside the wall.
  const userJs = await compileUserSource(cfg.code);

  const isolate = new ivm.Isolate({ memoryLimit: WALL_MEMORY_MB });
  try {
    const context = await isolate.createContext();

    // Doorway 1: the DataPort bridge — one crossing per engine data load.
    await context.global.set(
      '__hostFetch',
      new ivm.Reference(async (method: string, argsJson: string) => {
        const portMethod = (
          port as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
        )[method];
        if (typeof portMethod !== 'function') {
          throw new Error(`unknown DataPort method: ${method}`);
        }
        return JSON.stringify(await portMethod.apply(port, JSON.parse(argsJson) as unknown[]));
      }),
    );
    // Doorway 2: fire-and-forget log lines (system progress / the strategy's console.*).
    await context.global.set(
      '__hostLog',
      new ivm.Reference((channel: string, level: string, text: string) => {
        if (channel === 'user') {
          onUserLog?.(level as Parameters<UserLogSink>[0], text);
        } else {
          onLog?.(text);
        }
      }),
    );

    await context.eval(await wallBundle(), { timeout: 60_000 });

    const cfgCopy = new ivm.ExternalCopy(
      JSON.stringify({
        userJs,
        start: cfg.start,
        end: cfg.end,
        initialCash: cfg.initialCash,
        cost: cfg.cost,
        locale: cfg.locale,
        customFactors: cfg.customFactors,
        paramOverrides: cfg.paramOverrides,
        captureUserLogs: onUserLog != null,
        captureSignals,
      }),
    );
    await context.global.set('__cfg', cfgCopy.copyInto({ release: true }));
    const resultJson = await context.eval('__runBacktest(__cfg)', {
      timeout: WALL_TIMEOUT_MS,
      promise: true,
      copy: true,
    });
    if (typeof resultJson !== 'string') {
      throw new Error('walled backtest returned a non-string result');
    }
    return JSON.parse(resultJson) as BacktestResult | SignalBacktestOutput;
  } finally {
    isolate.dispose();
  }
}
