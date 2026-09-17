import { validateJson } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { sqlQueryBodySchema } from '../schema.js';
import { CHART_ROW_CAP, runComputeChartRows } from '../tools/charts/replay.js';
import { computeChartSpecSchema } from '../tools/charts/spec.js';
import { jsonSafe, runReadOnlySql } from '../tools/sql/read-only-sql.js';

export const agentChartRoute = new Hono();

// Historical chart cards persist queries, not points. Re-query current data through the same
// market-table whitelist and read-only connection used by sqlQuery.
agentChartRoute.post('/sql-queries', validateJson(sqlQueryBodySchema), async (c) => {
  const { sql } = c.req.valid('json');

  const rows = await runReadOnlySql(sql, CHART_ROW_CAP);
  // Raw SQLite integers arrive as BigInt — normalize through jsonSafe before Hono serializes.
  return c.json(JSON.parse(JSON.stringify({ rows }, jsonSafe)));
});

// Historical compute cards keep their original queries/code and sandbox contract. Re-run them
// against current data; these results are not a snapshot of the original conversation.
agentChartRoute.post('/chart-computations', validateJson(computeChartSpecSchema), async (c) => {
  const rows = await runComputeChartRows(c.req.valid('json'));
  return c.json(JSON.parse(JSON.stringify({ rows }, jsonSafe)));
});
