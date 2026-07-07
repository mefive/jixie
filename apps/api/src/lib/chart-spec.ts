import { z } from 'zod';

/** Wire validation for ChartSpec (@jixie/shared chart.ts) — the query that draws a chart card.
 * Shared by the renderChart agent tool (args) and the chat-message schema (persisted chart parts). */
export const chartSpecSchema = z.object({
  kind: z
    .enum(['line', 'bar', 'scatter'])
    .describe('图类型:line 时序/趋势、bar 分组对比、scatter 两量关系'),
  sql: z
    .string()
    .min(8)
    .max(4000)
    .describe(
      '产出数据点的单条 SELECT(SQLite 方言,同 sqlQuery 的表白名单),行数≤500,注意 ORDER BY 决定点的顺序',
    ),
  x: z.string().min(1).max(60).describe('作为 X 轴的结果列名(如 tradeDate / industry)'),
  series: z
    .array(
      z.object({
        column: z.string().min(1).max(60).describe('作为一条序列 Y 值的结果列名'),
        label: z.string().max(30).optional().describe('图例名(缺省用列名)'),
      }),
    )
    .min(1)
    .max(5)
    .describe('要画的序列(1~5 条)'),
});
