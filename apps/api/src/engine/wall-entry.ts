import { runStrategy } from './run.js';
import { defineStrategy } from '../strategy/code/sdk.js';
import { makeSandboxConsole, noopSandboxConsole } from '../lib/sandbox-console.js';
import type { EngineDataPort } from './data-port.js';
import type { CustomFactorModule } from './custom-factor.js';
import type { Strategy } from './types.js';
import type { Locale } from '@jixie/shared';

/**
 * The walled lane's IN-WALL entry (sandbox Phase B2). This file is esbuild-BUNDLED (engine + SDK +
 * stats + i18n messages — all pure ECMAScript; prisma-port is aliased out) and evaluated inside an
 * isolated-vm isolate by walled-run.ts. Everything here executes with NO Node world around it.
 *
 * The wall's two doorways, both host-provided References:
 *   - __hostFetch: the DataPort bridge. Each engine data load becomes ONE crossing —
 *     applySyncPromise blocks the isolate's own thread while the host answers with Prisma
 *     (the host event loop keeps running). Crossings ≈ DB queries, already minimized by
 *     EngineData's caching, so no per-ctx-call chatter.
 *   - __hostLog: fire-and-forget log lines (system progress + the strategy's console.*).
 * The user strategy module (host-compiled TS→CJS) is evaluated in here too — same JS world as the
 * engine, which is exactly the direct lane's semantics, just inside the wall.
 */

interface HostFn {
  applySyncPromise(receiver: undefined, args: unknown[]): unknown;
  applyIgnored(receiver: undefined, args: unknown[]): void;
}
declare const __hostFetch: HostFn;
declare const __hostLog: HostFn;

const bridgePort: EngineDataPort = new Proxy({} as EngineDataPort, {
  get(_target, method: string) {
    return (...args: unknown[]) =>
      // Sync from the isolate's point of view (its thread parks); async on the host.
      Promise.resolve(
        JSON.parse(
          __hostFetch.applySyncPromise(undefined, [method, JSON.stringify(args)]) as string,
        ),
      );
  },
});

interface WalledConfig {
  userJs: string; // the strategy module, host-compiled to CJS
  start: string;
  end: string;
  initialCash: number;
  cost?: Record<string, number>;
  locale?: Locale;
  customFactors?: CustomFactorModule[]; // host-prepared factor modules, evaluated in-wall by run.ts
  captureUserLogs: boolean;
}

(globalThis as Record<string, unknown>).__runBacktest = async (cfgJson: string) => {
  const cfg = JSON.parse(cfgJson) as WalledConfig;

  // Evaluate the user strategy module — mirrors compileStrategy's evaluation half (the TS→CJS
  // transform already happened host-side; error message shapes must stay identical).
  const sandboxConsole = cfg.captureUserLogs
    ? makeSandboxConsole(
        (level, text) => __hostLog.applyIgnored(undefined, ['user', level, text]),
        2000,
        cfg.locale,
      )
    : noopSandboxConsole;
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  try {
    const run = new Function(
      'module',
      'exports',
      'defineStrategy',
      'console',
      'require',
      cfg.userJs,
    );
    run(mod, mod.exports, defineStrategy, sandboxConsole, (id: string) => {
      throw new Error(
        `strategy code cannot import external modules (${id}) — all capabilities are on ctx`,
      );
    });
  } catch (e) {
    throw new Error(`strategy code execution error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const strategy = (mod.exports.default ?? mod.exports) as Partial<Strategy>;
  if (!strategy || typeof strategy.onBar !== 'function') {
    throw new Error('strategy must `export default defineStrategy({ onBar(ctx) { … } })`');
  }
  if (!strategy.name) {
    strategy.name = 'Untitled strategy';
  }

  const result = await runStrategy({
    start: cfg.start,
    end: cfg.end,
    initialCash: cfg.initialCash,
    cost: cfg.cost,
    locale: cfg.locale,
    strategy: strategy as Strategy,
    dataPort: bridgePort,
    customFactors: cfg.customFactors,
    onLog: (line) => __hostLog.applyIgnored(undefined, ['system', 'info', line]),
  });
  return JSON.stringify(result);
};
