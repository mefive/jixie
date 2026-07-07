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
  title: z.string().min(1).max(60).describe('图表标题(给用户看,中文)'),
});

/** Render a chart from a read-only SQL result. The executed spec (query + column mapping) doubles
 * as a chart card in the reply — the frontend re-runs it on render, same freshness contract as
 * query cards. The model never draws; it only maps columns, so there is no hallucination surface
 * on the data itself. */
export const renderChartTool: AgentTool = {
  name: 'renderChart',
  description: `用只读 SQL 的结果画图表(折线/柱状/散点),图会以卡片形式直接展示给用户。先想清楚 SQL 要产出什么形状:每行一个 X 值,选中的列是各序列的 Y 值(多序列先在 SQL 里聚合/透视成列)。适合:指数走势、行业均值对比、估值分布(先在 SQL 里分桶 GROUP BY)、两个量的散点关系。表白名单与 sqlQuery 相同;时序请 ORDER BY 日期升序。画完不必再用文字复述数据点。`,
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`参数不合法:${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }

    const { title, ...spec } = parsed.data;
    const rows = await runReadOnlySql(spec.sql, CHART_ROW_CAP);
    if (!rows.length) {
      throw new Error('查询没有返回任何行,画不了图;请检查条件或先用 sqlQuery 探查');
    }

    // Column mapping must hold on the actual result — a wrong column name fails the whole call
    // here (observation feedback) instead of rendering an empty chart at the user.
    const availableColumns = Object.keys(rows[0]);
    const missing = [spec.x, ...spec.series.map((series) => series.column)].filter(
      (column) => !availableColumns.includes(column),
    );
    if (missing.length) {
      throw new Error(
        `结果集中没有列:${missing.join('、')}(实际列:${availableColumns.join('、')})`,
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
