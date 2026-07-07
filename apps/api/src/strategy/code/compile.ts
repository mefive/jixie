import { transform } from 'esbuild';
import type { Strategy } from '../../engine/types.js';
import {
  makeSandboxConsole,
  noopSandboxConsole,
  type SandboxConsole,
  type UserLogSink,
} from '../../lib/sandbox-console.js';
import { defineStrategy } from './sdk.js';

/**
 * Compile user-authored TypeScript into an engine Strategy. This single function IS the execution
 * boundary of the code-first model: in (a TS source string), out (a `{ name, onBar, ... }` the engine
 * runs). Authoring is import-free — `defineStrategy` and the ctx types are an injected ambient (a .d.ts
 * gives Monaco the same surface), so a strategy is just `export default defineStrategy({ ... })`.
 *
 * Since 2026-07 the PRODUCT path runs strategies on the walled lane instead (engine/walled-run.ts:
 * the engine is bundled into an isolated-vm isolate and the module evaluates in-wall). This host
 * `new Function` evaluation remains for two trusted uses only: compile VALIDATION (agent/routes
 * compile-check, evaluated and discarded) and the DIRECT lane (repo-checked-in strategies in
 * research scripts/tests — the lane rule follows the code's origin, see python-and-sandbox.md).
 */
export async function compileStrategy(source: string, onUserLog?: UserLogSink): Promise<Strategy> {
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
    ? makeSandboxConsole(onUserLog)
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

  const strategy = (mod.exports.default ?? mod.exports) as Partial<Strategy>;
  if (!strategy || typeof strategy.onBar !== 'function') {
    throw new Error('strategy must `export default defineStrategy({ onBar(ctx) { … } })`');
  }
  if (!strategy.name) {
    strategy.name = 'Untitled strategy';
  }
  return strategy as Strategy;
}

function blockedRequire(id: string): never {
  throw new Error(
    `strategy code cannot import external modules (${id}) — all capabilities are on ctx`,
  );
}
