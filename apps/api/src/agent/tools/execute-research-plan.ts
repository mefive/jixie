import { z } from 'zod';
import { executeResearchPlan } from '../../research/executor.js';
import { researchPlanSpecV1Schema } from '../../research/spec.js';
import type { AgentTool } from './types.js';

const argsSchema = z.strictObject({ plan: researchPlanSpecV1Schema });

/** The only data execution tool exposed to Research Agent: structured plan in, deterministic run out. */
export const executeResearchPlanTool: AgentTool = {
  name: 'executeResearchPlan',
  description:
    'Execute one validated, versioned ResearchPlan. V1 supports the time_series_relationship protocol over registered instrument, macro, yield-curve, or FX series. The plan may reference only measures and sources returned by searchResearchCatalog. Never put SQL, table names, column names, JavaScript, or Python in the plan. Positive predictorLag means the predictor precedes the outcome by that many aligned periods. Use monthly alignment for year_over_year. Set alignment.partialPeriod to exclude for complete-month analysis; include is only for an explicitly requested month-to-date observation. The tool produces the structured research result card; your final text should explain the evidence and limitations without inventing numbers.',
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
    return {
      observation: JSON.stringify({
        protocol: run.protocol.id,
        observations: result.observations,
        pearson: result.pearson,
        spearman: result.spearman,
        regression: result.regression,
        coverage: run.coverage,
        diagnostics: run.diagnostics,
      }),
      rows: result.observations,
      research: { title: run.plan.question.slice(0, 120), run },
    };
  },
};
