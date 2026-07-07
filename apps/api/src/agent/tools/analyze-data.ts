import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { STATS_DOC } from '../../lib/stats-doc.js';
import { jsonSafe, runReadOnlySql } from './read-only-sql.js';
import type { AgentTool } from './types.js';

/**
 * analyzeData — SQL 取数 + 沙盒 JS 变换,一次调用打包(设计:docs/design/agent-code-tool.md)。
 * SQLite 表达不了的统计(相关/回归/多步流水线)的逃生舱。Two invariants:
 *   - data NEVER passes through the model: queries run server-side, rows flow straight into the
 *     sandbox, only the (size-capped) RESULT goes back as the observation;
 *   - the code runs in a per-call worker thread (memory-capped via resourceLimits, wall-clock
 *     timeout enforced by terminate) with the compileFactor-style new Function sandbox inside.
 */
const ANALYZE_ROW_CAP = 10_000; // per query — larger than sqlQuery's cap; rows don't hit the model
const RESULT_CHAR_CAP = 8_000;
const EXECUTION_TIMEOUT_MS = 10_000; // includes worker spawn (dev tsx boot ≈ 300ms)

// Worker entry: dev (tsx) spawns the .mjs bootstrap; prod spawns the compiled .js.
const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./analyze-worker.boot.mjs', import.meta.url)
  : new URL('./analyze-worker.js', import.meta.url);

const argsSchema = z.object({
  purpose: z.string().min(1).max(100).describe('一句话说明这次计算的目的(展示给用户)'),
  queries: z
    .array(
      z.object({
        name: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .max(30)
          .describe('结果在代码里的变量名(data.<name>)'),
        sql: z.string().min(8).max(4000).describe('单条 SELECT(同 sqlQuery 的表白名单与守卫)'),
      }),
    )
    .min(1)
    .max(4)
    .describe('取数查询(1~4 条),各自的结果行数组注入 data'),
  code: z
    .string()
    .min(10)
    .max(8000)
    .describe(
      'JS/TS 模块:export default ({ data, stats }) => 结果(JSON 可序列化,请聚合到少量数字)',
    ),
});

function executeInWorker(
  code: string,
  data: Record<string, Record<string, unknown>[]>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      workerData: { code, data },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
        void worker.terminate();
      }
    };
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new Error(`代码执行超过 ${EXECUTION_TIMEOUT_MS / 1000}s 超时,请减少数据量或简化计算`),
          ),
        ),
      EXECUTION_TIMEOUT_MS,
    );
    timer.unref();
    worker.on('message', (msg: { ok: boolean; result?: unknown; error?: string }) => {
      clearTimeout(timer);
      settle(() => (msg.ok ? resolve(msg.result) : reject(new Error(msg.error ?? '执行失败'))));
    });
    worker.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(err));
    });
  });
}

/** SQL fetch + sandboxed JS transform in one call — for statistics SQL can't express. */
export const analyzeDataTool: AgentTool = {
  name: 'analyzeData',
  description: `SQL 取数 + 一段 JS 代码做统计计算,一次调用完成(数据不进对话,只回计算结果)。适合 sqlQuery 算不动的:相关性、回归(β/α)、波动率、分位数、多步骤衍生计算。**简单聚合仍用 sqlQuery;IC/分层因子检验去因子页;回测去实验室——别用本工具重造。**
用法:queries 里写 1~4 条 SELECT(表白名单同 sqlQuery),每条结果以行数组注入 data.<name>;code 是一个模块:
export default ({ data, stats }) => { …; return { 聚合后的结果 }; }
注意:日期是 'YYYYMMDD' 字符串;数值列可能为 null 要过滤;返回值必须 JSON 可序列化且**聚合到少量数字**(超 ${RESULT_CHAR_CAP} 字符会报错)。
stats 可用函数:
${STATS_DOC}
示例——两指数日收益相关性:
queries: [{name:'a', sql:"SELECT tradeDate, close FROM IndexDaily WHERE tsCode='000300.SH' ORDER BY tradeDate"}, {name:'b', sql:"…000852.SH…"}]
code: "export default ({ data, stats }) => { const closeByDate = new Map(data.b.map(r => [r.tradeDate, r.close])); const pairs = data.a.filter(r => closeByDate.has(r.tradeDate)).map(r => [r.close, closeByDate.get(r.tradeDate)]); const rets = (xs) => xs.slice(1).map((v, i) => v / xs[i] - 1); const ra = rets(pairs.map(p => p[0])); const rb = rets(pairs.map(p => p[1])); return { corr: stats.pearson(ra, rb), days: ra.length }; }"`,
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`参数不合法:${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }

    const { queries, code } = parsed.data;
    const names = new Set(queries.map((query) => query.name));
    if (names.size !== queries.length) {
      throw new Error('queries 的 name 不能重复');
    }

    const data: Record<string, Record<string, unknown>[]> = {};
    let totalRows = 0;
    for (const query of queries) {
      const rows = await runReadOnlySql(query.sql, ANALYZE_ROW_CAP);
      data[query.name] = rows;
      totalRows += rows.length;
    }

    const result = await executeInWorker(code, data);
    const observation = JSON.stringify(
      {
        result,
        rows: Object.fromEntries(queries.map((query) => [query.name, data[query.name].length])),
      },
      jsonSafe,
    );
    if (observation.length > RESULT_CHAR_CAP) {
      throw new Error(`结果过大(${observation.length} 字符),请在代码里聚合到少量数字/短数组再返回`);
    }
    return { observation, rows: totalRows };
  },
};
