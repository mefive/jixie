import { z } from 'zod';

/** Wire validation for ChartSpec (@jixie/shared chart.ts) — the query that draws a chart card.
 * Shared by the renderChart agent tool (args) and the chat-message schema (persisted chart parts). */
export const chartSpecSchema = z.object({
  kind: z
    .enum(['line', 'bar', 'scatter'])
    .describe(
      'chart kind: line for time series/trend, bar for grouped comparison, scatter for the relationship between two quantities',
    ),
  sql: z
    .string()
    .min(8)
    .max(4000)
    .describe(
      'a single SELECT producing the data points (SQLite dialect, same table whitelist as sqlQuery), ≤500 rows; note that ORDER BY determines the point order',
    ),
  x: z
    .string()
    .min(1)
    .max(60)
    .describe('the result column used as the X axis (e.g. tradeDate / industry)'),
  series: z
    .array(
      z.object({
        column: z
          .string()
          .min(1)
          .max(60)
          .describe("the result column holding one series' Y values"),
        label: z.string().max(30).optional().describe('legend name (defaults to the column name)'),
      }),
    )
    .min(1)
    .max(5)
    .describe('the series to draw (1–5)'),
});
