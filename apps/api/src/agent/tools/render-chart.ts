import type { ChartSpec } from '@jixie/shared';
import { z } from 'zod';
import { sqlChartSpecSchema } from '../../lib/chart-spec.js';
import { jsonSafe, runReadOnlySql } from './read-only-sql.js';
import type { AgentTool } from './types.js';

/** Charts may carry more points than a tabular observation (a 2-year daily series ≈ 490 rows). */
export const CHART_ROW_CAP = 500;

export const OBSERVATION_SAMPLE_ROWS = 5;

/** The columns a spec maps must exist on the actual rows — fail with observation feedback instead
 * of rendering an empty chart at the user. Shared by the sql and compute chart tools. */
export function assertChartColumns(
  rows: Record<string, unknown>[],
  spec: { x: string; series: { column: string }[] },
): void {
  const availableColumns = Object.keys(rows[0] ?? {});
  const missing = [spec.x, ...spec.series.map((series) => series.column)].filter(
    (column) => !availableColumns.includes(column),
  );
  if (missing.length) {
    throw new Error(
      `The result set has no such columns: ${missing.join(', ')} (actual columns: ${availableColumns.join(', ')})`,
    );
  }
}

// Tool args = the persisted ChartSpec + a display title (the title lives on the part, not the spec).
const argsSchema = sqlChartSpecSchema.extend({
  title: z
    .string()
    .min(1)
    .max(60)
    .describe("chart title (shown to the user, in the same language as the user's question)"),
});

/** Render a chart from a read-only SQL result. The executed spec (query + column mapping) doubles
 * as a chart card in the reply — the frontend re-runs it on render, same freshness contract as
 * query cards. The model never draws; it only maps columns, so there is no hallucination surface
 * on the data itself. */
export const renderChartTool: AgentTool = {
  name: 'renderChart',
  description: `Draw a chart from a read-only SQL result; the chart is shown directly to the user as a card. Think first about the shape the SQL must produce: one X value per row, and the selected columns are the Y values of each series (for multiple series, aggregate/pivot into columns in SQL first). Kinds: line (trend), bar (grouped comparison), scatter (two-quantity relation), area (NAV / cumulative curves), stackedBar (composition — each series is one layer), histogram (distribution — bucket with GROUP BY first, one row per bucket), combo (mixed line/bar series; per-series \`type: 'bar'\` and \`yAxis: 'right'\` for a second axis, e.g. close line + volume bars). The table whitelist is the same as sqlQuery; for time series, ORDER BY date ascending. When the rows need a JS computation first (rolling correlation, regression, drawdown), use renderComputedChart instead. Once drawn, you need not restate the data points in text.`,
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }

    const { title, ...spec } = parsed.data;
    const rows = await runReadOnlySql(spec.sql, CHART_ROW_CAP);
    if (!rows.length) {
      throw new Error(
        'The query returned no rows, so no chart can be drawn; check the conditions or explore with sqlQuery first',
      );
    }

    assertChartColumns(rows, spec);

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
