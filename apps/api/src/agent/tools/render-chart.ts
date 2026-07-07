import type { ChartSpec } from '@jixie/shared';
import { z } from 'zod';
import { chartSpecSchema } from '../../lib/chart-spec.js';
import { jsonSafe, runReadOnlySql } from './read-only-sql.js';
import type { AgentTool } from './types.js';

/** Charts may carry more points than a tabular observation (a 2-year daily series ≈ 490 rows). */
export const CHART_ROW_CAP = 500;

const OBSERVATION_SAMPLE_ROWS = 5;

// Tool args = the persisted ChartSpec + a display title (the title lives on the part, not the spec).
const argsSchema = chartSpecSchema.extend({
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
  description: `Draw a chart (line / bar / scatter) from a read-only SQL result; the chart is shown directly to the user as a card. Think first about the shape the SQL must produce: one X value per row, and the selected columns are the Y values of each series (for multiple series, aggregate/pivot into columns in SQL first). Good for: index trends, cross-industry mean comparisons, valuation distributions (bucket with GROUP BY in SQL first), the scatter relationship between two quantities. The table whitelist is the same as sqlQuery; for time series, ORDER BY date ascending. Once drawn, you need not restate the data points in text.`,
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

    // Column mapping must hold on the actual result — a wrong column name fails the whole call
    // here (observation feedback) instead of rendering an empty chart at the user.
    const availableColumns = Object.keys(rows[0]);
    const missing = [spec.x, ...spec.series.map((series) => series.column)].filter(
      (column) => !availableColumns.includes(column),
    );
    if (missing.length) {
      throw new Error(
        `The result set has no such columns: ${missing.join(', ')} (actual columns: ${availableColumns.join(', ')})`,
      );
    }

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
