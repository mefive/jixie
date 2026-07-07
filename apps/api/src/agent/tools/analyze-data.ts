import { z } from 'zod';
import { STATS_DOC } from '../../lib/stats-doc.js';
import { runAnalysisCode } from './analyze-sandbox.js';
import { jsonSafe, runReadOnlySql } from './read-only-sql.js';
import type { AgentTool } from './types.js';

/**
 * analyzeData — SQL fetch + sandboxed JS transform, packaged into a single call (design:
 * docs/design/agent-code-tool.md). An escape hatch for statistics SQLite can't express
 * (correlation / regression / multi-step pipelines). Two invariants:
 *   - data NEVER passes through the model: queries run server-side, rows flow straight into the
 *     sandbox, only the (size-capped) RESULT goes back as the observation;
 *   - the code runs inside an isolated-vm isolate (no Node APIs in-wall, own memory limit,
 *     CPU timeout) — see lib/isolate-run.ts for the layering.
 */
const ANALYZE_ROW_CAP = 10_000; // per query — larger than sqlQuery's cap; rows don't hit the model
const RESULT_CHAR_CAP = 8_000;
const EXECUTION_TIMEOUT_MS = 10_000;

const argsSchema = z.object({
  purpose: z
    .string()
    .min(1)
    .max(100)
    .describe("a one-sentence description of this computation's purpose (shown to the user)"),
  queries: z
    .array(
      z.object({
        name: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .max(30)
          .describe('the variable name for this result in code (data.<name>)'),
        sql: z
          .string()
          .min(8)
          .max(4000)
          .describe('a single SELECT (same table whitelist and guards as sqlQuery)'),
      }),
    )
    .min(1)
    .max(4)
    .describe('fetch queries (1–4); each result row-array is injected into data'),
  code: z
    .string()
    .min(10)
    .max(8000)
    .describe(
      'JS/TS module: export default ({ data, stats }) => result (JSON-serializable; please aggregate down to a few numbers)',
    ),
});

/** SQL fetch + sandboxed JS transform in one call — for statistics SQL can't express. */
export const analyzeDataTool: AgentTool = {
  name: 'analyzeData',
  description: `SQL fetch + a piece of JS code for statistical computation, completed in one call (data never enters the conversation, only the computed result comes back). Good for what sqlQuery can't compute: correlation, regression (β/α), volatility, quantiles, multi-step derived calculations. **Simple aggregation still uses sqlQuery; IC / layered factor tests go to the factor page; backtests go to the lab — don't rebuild those with this tool.**
Usage: write 1–4 SELECTs in queries (same table whitelist as sqlQuery); each result is injected as a row-array into data.<name>; code is a module:
export default ({ data, stats }) => { …; return { aggregated result }; }
Notes: dates are 'YYYYMMDD' strings; numeric columns may be null and must be filtered; the return value must be JSON-serializable and **aggregated down to a few numbers** (exceeding ${RESULT_CHAR_CAP} characters raises an error).
Available stats functions:
${STATS_DOC}
Example — daily-return correlation of two indexes:
queries: [{name:'a', sql:"SELECT tradeDate, close FROM IndexDaily WHERE tsCode='000300.SH' ORDER BY tradeDate"}, {name:'b', sql:"…000852.SH…"}]
code: "export default ({ data, stats }) => { const closeByDate = new Map(data.b.map(r => [r.tradeDate, r.close])); const pairs = data.a.filter(r => closeByDate.has(r.tradeDate)).map(r => [r.close, closeByDate.get(r.tradeDate)]); const rets = (xs) => xs.slice(1).map((v, i) => v / xs[i] - 1); const ra = rets(pairs.map(p => p[0])); const rb = rets(pairs.map(p => p[1])); return { corr: stats.pearson(ra, rb), days: ra.length }; }"`,
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }

    const { queries, code } = parsed.data;
    const names = new Set(queries.map((query) => query.name));
    if (names.size !== queries.length) {
      throw new Error('query names must be unique');
    }

    const data: Record<string, Record<string, unknown>[]> = {};
    let totalRows = 0;
    for (const query of queries) {
      const rows = await runReadOnlySql(query.sql, ANALYZE_ROW_CAP);
      data[query.name] = rows;
      totalRows += rows.length;
    }

    const result = await runAnalysisCode(code, data, { timeoutMs: EXECUTION_TIMEOUT_MS });
    const observation = JSON.stringify(
      {
        result,
        rows: Object.fromEntries(queries.map((query) => [query.name, data[query.name].length])),
      },
      jsonSafe,
    );
    if (observation.length > RESULT_CHAR_CAP) {
      throw new Error(
        `Result too large (${observation.length} characters); aggregate down to a few numbers / a short array in your code before returning`,
      );
    }
    return { observation, rows: totalRows };
  },
};
