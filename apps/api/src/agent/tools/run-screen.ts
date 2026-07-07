import type { ScreenSpec } from '@jixie/shared';
import { z } from 'zod';
import { runScreen } from '../../screen/query.js';
import { screenSpecSchema } from '../../screen/spec.js';
import type { AgentTool } from './types.js';

const OBSERVATION_ROW_CAP = 50;

/** A short human title for the card, derived from the spec (the user can rename on save). */
export function describeSpec(spec: ScreenSpec): string {
  if (!spec.filters.length) {
    return spec.sort ? `全市场按 ${spec.sort.field} 排序` : '全市场快照';
  }
  return spec.filters.map((filter) => `${filter.field}${filter.op}${filter.value}`).join(' 且 ');
}

/** Run a whitelisted screen spec against the latest whole-market snapshot. The executed spec doubles
 * as a query card in the reply (spec, not rows — re-runnable and editable, per the design). */
export const runScreenTool: AgentTool = {
  name: 'runScreen',
  description: `按指标筛选 A 股最新快照(不是回测)。字段:close 收盘价、pctChg 当日涨跌幅%、pe/peTtm 市盈率、pb 市净率、ps 市销率、dvRatio 股息率%、totalMv 总市值、circMv 流通市值、turnoverRate 换手率%。**单位约定**:市值单位是万元(500亿 = 5000000);比率/百分数直接用数值(股息率 3% 写 3)。「便宜/低估」常指 pe 或 pb 较小,「大盘股」指 totalMv 较大。`,
  parameters: z.toJSONSchema(screenSpecSchema),
  async run(args) {
    const parsed = screenSpecSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `spec 不合法:${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }

    const spec = parsed.data as ScreenSpec;
    const result = await runScreen(spec);
    const observationRows = result.rows.slice(0, OBSERVATION_ROW_CAP);
    return {
      observation: JSON.stringify({
        tradeDate: result.tradeDate,
        total: result.total,
        returned: observationRows.length,
        rows: observationRows,
      }),
      rows: observationRows.length,
      card: { title: describeSpec(spec), spec },
    };
  },
};
