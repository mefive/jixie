import { z } from 'zod';

/** Wire validation for ChartSpec (@jixie/shared chart.ts) — the query that draws a chart card.
 * Shared by the renderChart / renderComputedChart agent tools (args) and the chat-message schema
 * (persisted chart parts). */
const chartKindSchema = z
  .enum(['line', 'bar', 'scatter', 'area', 'stackedBar', 'histogram', 'combo'])
  .describe(
    'chart kind: line for time series/trend, bar for grouped comparison, scatter for the relationship between two quantities, area for NAV/cumulative curves, stackedBar for composition, histogram for distributions (bucket with GROUP BY first), combo for mixed line/bar series (optionally on a right-hand y axis)',
  );

const chartSeriesSchema = z
  .array(
    z.object({
      column: z.string().min(1).max(60).describe("the result column holding one series' Y values"),
      label: z.string().max(30).optional().describe('legend name (defaults to the column name)'),
      type: z
        .enum(['line', 'bar'])
        .optional()
        .describe("combo only: this series' mark (defaults to line)"),
      yAxis: z
        .enum(['left', 'right'])
        .optional()
        .describe(
          "combo only: 'right' puts the series on a second value axis (different magnitude, e.g. volume next to price)",
        ),
    }),
  )
  .min(1)
  .max(5)
  .describe('the series to draw (1–5)');

const xSchema = z
  .string()
  .min(1)
  .max(60)
  .describe('the result column used as the X axis (e.g. tradeDate / industry)');

export const sqlChartSpecSchema = z.object({
  source: z.literal('sql').optional(),
  kind: chartKindSchema,
  sql: z
    .string()
    .min(8)
    .max(4000)
    .describe(
      'a single SELECT producing the data points (SQLite dialect, same table whitelist as sqlQuery), ≤500 rows; note that ORDER BY determines the point order',
    ),
  x: xSchema,
  series: chartSeriesSchema,
});

export const computeChartSpecSchema = z.object({
  source: z.literal('compute'),
  kind: chartKindSchema,
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
      'JS/TS module: export default ({ data, stats }) => rows — an ARRAY of flat row objects to draw (≤500), each row holding the x column plus every series column',
    ),
  x: xSchema,
  series: chartSeriesSchema,
});

export const chartSpecSchema = z.union([computeChartSpecSchema, sqlChartSpecSchema]);
