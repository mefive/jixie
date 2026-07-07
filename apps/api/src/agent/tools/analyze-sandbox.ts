import { transform } from 'esbuild';
import * as stats from '../../lib/stats.js';

/**
 * Compile + run one analyzeData code module — the same sandbox boundary as compileFactor
 * (esbuild strips types, new Function with a whitelist of injected identifiers, require blocked).
 * The module must `export default ({ data, stats }) => result`; the result must be
 * JSON-serializable. Runs inside the analyze worker thread (hard timeout / memory limits are the
 * host's job); kept as a pure function so tests can exercise it without threads.
 */
export async function runAnalysisCode(
  code: string,
  data: Record<string, Record<string, unknown>[]>,
): Promise<unknown> {
  let js: string;
  try {
    ({ code: js } = await transform(code, { loader: 'ts', format: 'cjs', target: 'es2022' }));
  } catch (e) {
    throw new Error(`代码编译失败:${e instanceof Error ? e.message : String(e)}`);
  }

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  try {
    const run = new Function('module', 'exports', 'require', js);
    run(mod, mod.exports, blockedRequire);
  } catch (e) {
    throw new Error(`代码执行出错:${e instanceof Error ? e.message : String(e)}`);
  }

  const entry = (mod.exports.default ?? mod.exports) as unknown;
  if (typeof entry !== 'function') {
    throw new Error('代码需 `export default ({ data, stats }) => 结果`');
  }
  return (entry as (input: { data: typeof data; stats: typeof stats }) => unknown)({ data, stats });
}

function blockedRequire(id: string): never {
  throw new Error(`分析代码不能 import 外部模块(${id})——数据在 data 上、统计函数在 stats 上`);
}
