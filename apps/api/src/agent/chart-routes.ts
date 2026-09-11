import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { runReadOnlySql, jsonSafe } from './tools/sql/read-only-sql.js';
import { CHART_ROW_CAP } from './tools/charts/render-chart.js';
import { runComputeChartRows } from './tools/charts/render-computed-chart.js';
import { computeChartSpecSchema } from './tools/charts/spec.js';

export const agentChartRoute = new Hono();

const sqlBody = z.object({ sql: z.string().min(8).max(4000) });

// Read-only SQL over the market-table whitelist (same guard as the agent's sqlQuery/renderChart
// tools). Consumed by chart cards, which persist the query and re-run it on render.
agentChartRoute.post('/sql-queries', validateJson(sqlBody), async (c) => {
  const { sql } = c.req.valid('json');
  try {
    const rows = await runReadOnlySql(sql, CHART_ROW_CAP);
    // Raw SQLite integers arrive as BigInt — normalize through jsonSafe before Hono serializes.
    return c.json(JSON.parse(JSON.stringify({ rows }, jsonSafe)));
  } catch (e) {
    return apiError(c, 'VALIDATION_FAILED', e instanceof Error ? e.message : m(c, 'queryFailed'));
  }
});

// Re-run a compute-source chart card (computed-chart.md Phase A): the persisted queries + code run
// through the same whitelist guard and analysis isolate as the renderComputedChart tool, and the
// validated row table comes back for the frontend to draw. Data never touches the LLM.
agentChartRoute.post('/chart-computations', validateJson(computeChartSpecSchema), async (c) => {
  try {
    const rows = await runComputeChartRows(c.req.valid('json'));
    return c.json(JSON.parse(JSON.stringify({ rows }, jsonSafe)));
  } catch (e) {
    return apiError(c, 'VALIDATION_FAILED', e instanceof Error ? e.message : m(c, 'queryFailed'));
  }
});
