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
  description: `Screen the latest A-share snapshot by metric (not a backtest). Fields: close (closing price), pctChg (daily change %), pe/peTtm (P/E), pb (P/B), ps (P/S), dvRatio (dividend yield %), totalMv (total market cap), circMv (float market cap), turnoverRate (turnover %). **Unit conventions**: market cap is in 万元 / 10k CNY (50 billion = 5000000); ratios/percentages use the raw number (a 3% dividend yield is written as 3). "cheap/undervalued" usually means a smaller pe or pb; "large-cap" means a larger totalMv.`,
  parameters: z.toJSONSchema(screenSpecSchema),
  async run(args) {
    const parsed = screenSpecSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid spec: ${parsed.error.issues
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
