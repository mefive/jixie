import { loadIsolatedModule, toCommonJs } from '../../lib/isolate-run.js';

/**
 * Compile + run one analyzeData code module inside an isolated-vm isolate (hard sandbox: no Node
 * APIs in-wall, own memory limit, per-run CPU timeout — a prototype escape lands in an empty
 * global). The module must `export default ({ data, stats }) => result`; stats (lib/stats.ts) is
 * evaluated in-wall so its calls never cross; data goes in / result comes out as one JSON string
 * each way.
 */
export async function runAnalysisCode(
  code: string,
  data: Record<string, Record<string, unknown>[]>,
  opts: { timeoutMs?: number } = {},
): Promise<unknown> {
  const userJs = await toCommonJs(code, '分析代码');
  const module = await loadIsolatedModule({
    userJs,
    withStats: true,
    noun: '分析代码',
    setup: `
      {
        const entry = __module.exports.default ?? __module.exports;
        if (typeof entry !== 'function') {
          throw new Error('需 \`export default ({ data, stats }) => 结果\`');
        }
        __entries.run = (dataJson) =>
          Promise.resolve(entry({ data: JSON.parse(dataJson), stats: globalThis.stats })).then(
            (result) => JSON.stringify(result ?? null),
          );
      }
    `,
  });

  try {
    const json = await module.callJson('run', [JSON.stringify(data)], {
      timeoutMs: opts.timeoutMs,
    });
    return JSON.parse(json);
  } finally {
    module.dispose();
  }
}
