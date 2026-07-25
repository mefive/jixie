import type { ChartSpec } from '@jixie/shared';
import { z } from 'zod';
import { computeChartSpecSchema } from '../../lib/chart-spec.js';
import { runAnalysisCode } from './analyze-sandbox.js';
import { jsonSafe, runReadOnlySql } from './read-only-sql.js';
import { assertChartColumns, CHART_ROW_CAP, OBSERVATION_SAMPLE_ROWS } from './render-chart.js';
import type { AgentTool } from './types.js';

/**
 * renderComputedChart — SQL fetch + sandboxed JS transform + chart card, in one call (design:
 * computed-chart.md Phase A). The compute twin of renderChart: analyzeData can calculate rolling /
 * regression / drawdown series but only answers in text; this tool draws the computed ROW TABLE.
 * Same invariants: data never passes through the model; the persisted spec (queries + code +
 * column mapping) re-runs on render; the model never produces pixels or ECharts options.
 */
const COMPUTE_QUERY_ROW_CAP = 10_000; // per fetch query — rows feed the sandbox, not the model
const EXECUTION_TIMEOUT_MS = 10_000;

const argsSchema = computeChartSpecSchema.omit({ source: true }).extend({
  title: z
    .string()
    .min(1)
    .max(60)
    .describe("chart title (shown to the user, in the same language as the user's question)"),
});

/** Coerce and validate a sandbox result into a drawable row table (pure — unit-testable):
 * an array of flat scalar objects (or { rows }), capped, containing every mapped column. */
export function normalizeComputeChartRows(
  result: unknown,
  spec: { x: string; series: { column: string }[] },
): Record<string, string | number | null>[] {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)
      ? ((result as { rows: unknown[] }).rows as unknown[])
      : null;
  if (!rows) {
    throw new Error(
      'The code must return an ARRAY of flat row objects (or { rows: [...] }) to draw — aggregate scalars belong to analyzeData',
    );
  }
  if (!rows.length) {
    throw new Error(
      'The code returned no rows, so no chart can be drawn; check the queries or the transform',
    );
  }
  if (rows.length > CHART_ROW_CAP) {
    throw new Error(
      `The code returned ${rows.length} rows (cap ${CHART_ROW_CAP}); aggregate or sample down in the code (e.g. monthly points instead of daily)`,
    );
  }

  const normalized: Record<string, string | number | null>[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Every returned row must be a flat object of scalars');
    }
    const flat: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (value == null) {
        flat[key] = null;
      } else if (typeof value === 'number' || typeof value === 'string') {
        flat[key] = value;
      } else if (typeof value === 'bigint') {
        flat[key] = Number(value);
      } else {
        throw new Error(
          `Row field '${key}' is not a scalar; rows must hold numbers/strings/null only`,
        );
      }
    }
    normalized.push(flat);
  }
  assertChartColumns(normalized, spec);
  return normalized;
}

/** Execute a compute chart spec: run its queries, run its code in the isolate, normalize the
 * returned row table. Shared by the agent tool (first render) and the re-run endpoint. */
export async function runComputeChartRows(spec: {
  queries: { name: string; sql: string }[];
  code: string;
  x: string;
  series: { column: string }[];
}): Promise<Record<string, string | number | null>[]> {
  const names = new Set(spec.queries.map((query) => query.name));
  if (names.size !== spec.queries.length) {
    throw new Error('query names must be unique');
  }

  const data: Record<string, Record<string, unknown>[]> = {};
  for (const query of spec.queries) {
    data[query.name] = await runReadOnlySql(query.sql, COMPUTE_QUERY_ROW_CAP);
  }

  const result = await runAnalysisCode(spec.code, data, { timeoutMs: EXECUTION_TIMEOUT_MS });
  return normalizeComputeChartRows(result, spec);
}

/** SQL fetch + sandboxed transform + chart card in one call — the compute-source chart tool. */
export const renderComputedChartTool: AgentTool = {
  name: 'renderComputedChart',
  description: `Compute a row table with JS (over 1–4 read-only SQL results, sandboxed, stats available like analyzeData) and draw it as a chart card shown directly to the user. Use when the points need a computation SQL can't express: rolling correlation/beta, regression fit series, drawdown curves, normalized rebased NAVs, return distributions computed in code. **Plain SQL-shaped charts still use renderChart; scalar answers still use analyzeData — this tool is only for drawing computed SERIES.**
The code is a module: export default ({ data, stats }) => rows — return an ARRAY of flat row objects (≤${CHART_ROW_CAP}), each holding your x column plus one column per series (e.g. [{ tradeDate:'20240105', corr:0.61 }, …]). Dates are 'YYYYMMDD' strings; filter nulls before math. kind/x/series follow renderChart (line/bar/scatter/area/stackedBar/histogram/combo).
Example — rolling 60-day return correlation of two stocks:
queries: [{name:'a', sql:"SELECT tradeDate, close FROM Daily WHERE tsCode='600519.SH' ORDER BY tradeDate"}, {name:'b', sql:"…000858.SZ…"}]
code: "export default ({ data, stats }) => { const closeByDate = new Map(data.b.map(r => [r.tradeDate, r.close])); const pairs = data.a.filter(r => r.close != null && closeByDate.get(r.tradeDate) != null).map(r => ({ date: r.tradeDate, a: r.close, b: closeByDate.get(r.tradeDate) })); const returns = (xs) => xs.slice(1).map((v, i) => v / xs[i] - 1); const ra = returns(pairs.map(p => p.a)); const rb = returns(pairs.map(p => p.b)); const rows = []; for (let i = 59; i < ra.length; i++) { rows.push({ tradeDate: pairs[i + 1].date, corr: stats.pearson(ra.slice(i - 59, i + 1), rb.slice(i - 59, i + 1)) }); } return rows; }"
kind: 'line', x: 'tradeDate', series: [{ column: 'corr', label: '60日滚动相关' }]
Once drawn, you need not restate the data points in text.`,
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }

    const { title, ...rest } = parsed.data;
    const spec = { source: 'compute' as const, ...rest };
    const rows = await runComputeChartRows(spec);

    return {
      observation: JSON.stringify(
        {
          rendered: true,
          title,
          rows: rows.length,
          sample: rows.slice(0, OBSERVATION_SAMPLE_ROWS),
        },
        jsonSafe,
      ),
      rows: rows.length,
      chart: { title, chart: spec as ChartSpec },
    };
  },
};
