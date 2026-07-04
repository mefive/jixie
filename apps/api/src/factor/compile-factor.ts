import { transform } from 'esbuild';
import {
  makeSandboxConsole,
  noopSandboxConsole,
  type SandboxConsole,
  type UserLogSink,
} from '../lib/sandbox-console.js';
import type { CustomFactor } from './factor-sdk.js';
import { defineFactor } from './factor-sdk.js';

/**
 * Compile a user-authored factor (defineFactor TS source) into a { name, compute } — the sandbox
 * boundary for custom factors, mirroring compileStrategy. Types are stripped (no type-check), so a bad
 * expression fails at compute time; `require` is blocked so factor code can't reach Node builtins.
 */
export async function compileFactor(
  source: string,
  onUserLog?: UserLogSink,
): Promise<CustomFactor> {
  let js: string;
  try {
    ({ code: js } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' }));
  } catch (e) {
    throw new Error(`因子代码编译失败:${e instanceof Error ? e.message : String(e)}`);
  }

  // compute() runs once per stock per rebalance date — same cap as strategies guards a runaway console.
  const sandboxConsole: SandboxConsole = onUserLog
    ? makeSandboxConsole(onUserLog)
    : noopSandboxConsole;

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  try {
    // Free identifiers resolve to these params: the CJS env + defineFactor + the console shim; require throws.
    const run = new Function('module', 'exports', 'defineFactor', 'console', 'require', js);
    run(mod, mod.exports, defineFactor, sandboxConsole, blockedRequire);
  } catch (e) {
    throw new Error(`因子代码执行出错:${e instanceof Error ? e.message : String(e)}`);
  }

  const factor = (mod.exports.default ?? mod.exports) as Partial<CustomFactor>;
  if (!factor || typeof factor.compute !== 'function') {
    throw new Error('因子需 `export default defineFactor({ name, compute(bar) { … } })`');
  }
  if (!factor.name) {
    factor.name = '未命名因子';
  }
  return factor as CustomFactor;
}

function blockedRequire(id: string): never {
  throw new Error(`因子代码不能 import 外部模块(${id})——数据都在 bar 上`);
}
