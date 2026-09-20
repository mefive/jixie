import { transform } from 'esbuild';
import { DEFAULT_LOCALE, type Locale, type StrategyParamValue } from '@jixie/shared';
import type { EngineStrategy } from '#engine/types.js';
import {
  makeSandboxConsole,
  noopSandboxConsole,
  type SandboxConsole,
  type UserLogSink,
} from '#infra/runtime/console.js';
import { applyStrategyParamOverrides, defineStrategy } from '../../../sdk/typescript.js';

/** Trusted repository fixtures only. Never evaluate user or model source on the host. */
export async function compileStrategy(
  source: string,
  onUserLog?: UserLogSink,
  locale: Locale = DEFAULT_LOCALE,
  paramOverrides?: Record<string, StrategyParamValue>,
): Promise<EngineStrategy> {
  let js: string;
  try {
    // TS → CJS JS: strip types, emit module.exports so we can capture `export default`.
    ({ code: js } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' }));
  } catch (e) {
    throw new Error(
      `strategy code compilation failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // The strategy's console.* is captured and tagged as user log (with a line cap); without a sink
  // (tests / codegen self-check) it's a no-op rather than leaking to the process stdout.
  const sandboxConsole: SandboxConsole = onUserLog
    ? makeSandboxConsole(onUserLog, 2000, locale)
    : noopSandboxConsole;

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  try {
    // Free identifiers in the generated code resolve to these params: the CJS env + the injected SDK +
    // the console shim. `require` throws so any `import` in user code fails loudly instead of reaching
    // Node builtins.
    const run = new Function('module', 'exports', 'defineStrategy', 'console', 'require', js);
    run(mod, mod.exports, defineStrategy, sandboxConsole, blockedRequire);
  } catch (e) {
    throw new Error(`strategy code execution error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const strategy = (mod.exports.default ?? mod.exports) as Partial<EngineStrategy>;
  if (!strategy || typeof strategy.onBar !== 'function') {
    throw new Error('strategy must `export default defineStrategy({ onBar(ctx) { … } })`');
  }
  if (!strategy.name) {
    strategy.name = 'Untitled strategy';
  }
  applyStrategyParamOverrides(strategy as EngineStrategy, paramOverrides);
  return strategy as EngineStrategy;
}

function blockedRequire(id: string): never {
  throw new Error(
    `strategy code cannot import external modules (${id}) — all capabilities are on ctx`,
  );
}
