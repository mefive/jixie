import type { UniverseSpecV1 } from '@jixie/shared';
import { z } from 'zod';
import { executeUniverseSpec } from '../../research/universe.js';
import { universeSpecV1Schema } from '../../research/spec.js';
import type { AgentTool } from './types.js';

const argsSchema = z.strictObject({ spec: universeSpecV1Schema });
const OBSERVATION_ROW_CAP = 50;

export function describeUniverse(spec: UniverseSpecV1): string {
  if (spec.predicates.length === 0) {
    return spec.sort ? `股票池 · 按 ${spec.sort.measure} 排序` : '中国股票市场';
  }
  return spec.predicates
    .map((predicate) => `${predicate.measure}${predicate.op}${predicate.value}`)
    .join(' 且 ')
    .slice(0, 120);
}

/** Deterministic point-in-time entity selection. The model supplies only the validated spec. */
export const runUniverseTool: AgentTool = {
  name: 'runUniverse',
  description:
    'Resolve a versioned point-in-time A-share UniverseSpec into a deterministic table. Use only universe measure ids and units returned by searchResearchCatalog. The model never supplies SQL or table/column names. fixed asOf resolves to the latest available trading snapshot on or before that date; latest_available uses the newest snapshot. index_members resolves historical membership on or before the snapshot. eligibility explicitly freezes minimum listing days, suspension exclusion, and risk-warning handling. The result is attached as a re-runnable Universe artifact.',
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid UniverseSpec: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const result = await executeUniverseSpec(parsed.data.spec);
    const rows = result.rows.slice(0, OBSERVATION_ROW_CAP);
    return {
      observation: JSON.stringify({
        asOfDate: result.asOfDate,
        membershipAsOfDate: result.membershipAsOfDate,
        dataRevision: result.dataRevision,
        total: result.total,
        returned: rows.length,
        rows,
        stages: result.stages,
        diagnostics: result.diagnostics,
      }),
      rows: rows.length,
      universe: { title: describeUniverse(result.spec), spec: result.spec },
    };
  },
};
