import { z } from 'zod';
import { executeResearchPlan } from '../../research/executor.js';
import { researchPlanSpecV1Schema } from '../../research/spec.js';
import type { AgentTool } from './types.js';

const argsSchema = z.strictObject({ plan: researchPlanSpecV1Schema });

/** The only data execution tool exposed to Research Agent: structured plan in, deterministic run out. */
export const executeResearchPlanTool: AgentTool = {
  name: 'executeResearchPlan',
  description:
    'Execute one validated, versioned ResearchPlan. V1 supports time_series_relationship over registered series and distribution_comparison over two disjoint point-in-time UniverseSpec groups. The plan.question object must prespecify the protocol estimand, direction, and null value, and outputs must include conclusion plus the protocol-required evidence. The plan may reference only measures and sources returned by searchResearchCatalog. Never put SQL, table names, column names, JavaScript, or Python in the plan. For time series, positive predictorLag means the predictor precedes the outcome; use monthly alignment for year_over_year and exclude incomplete periods unless explicitly requested. For a distribution comparison, both groups must use the same as-of time and measure, must not set UniverseSpec.limit, and must be mutually exclusive. The tool produces a structured research result and deterministic conclusion level; final prose must preserve that level and must not invent numbers.',
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid ResearchPlan: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const run = await executeResearchPlan(parsed.data.plan);
    const { result } = run;
    const evidence =
      result.kind === 'time_series_relationship'
        ? {
            pearson: result.pearson,
            spearman: result.spearman,
            regression: result.regression,
          }
        : {
            groups: result.groups.map((group) => ({
              inputId: group.inputId,
              label: group.label,
              summary: group.summary,
            })),
            comparison: result.comparison,
          };
    return {
      observation: JSON.stringify({
        protocol: run.protocol.id,
        observations: result.observations,
        ...evidence,
        conclusion: run.conclusion,
        coverage: run.coverage,
        diagnostics: run.diagnostics,
      }),
      rows: result.observations,
      research: { title: run.plan.question.text.slice(0, 120), run },
    };
  },
};
