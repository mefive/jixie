import { z } from 'zod';
import { executeResearchPlan } from '../../research/executor.js';
import { researchPlanSpecV1Schema } from '../../research/spec.js';
import type { AgentTool } from './types.js';

const argsSchema = z.strictObject({ plan: researchPlanSpecV1Schema });

/** The only data execution tool exposed to Research Agent: structured plan in, deterministic run out. */
export const executeResearchPlanTool: AgentTool = {
  name: 'executeResearchPlan',
  description:
    'Execute one validated, versioned ResearchPlan. V1 supports time_series_relationship, multivariate_time_series_relationship, distribution_comparison, and event_study. The plan.question object must prespecify the protocol estimand, direction, and null value, and outputs must include conclusion plus the protocol-required evidence. The plan may reference only measures and sources returned by searchResearchCatalog. Never put SQL, table names, column names, JavaScript, or Python in the plan. For multivariate time series, declare exactly one focal predictor and at least one prespecified control; the question focalPredictor must match, each predictor may have its own nonnegative lag, and variables must never be added or removed after inspecting significance. Use monthly alignment for year_over_year and exclude incomplete periods unless explicitly requested. For a distribution comparison, both groups must use the same as-of time and measure, must not set UniverseSpec.limit, and must be mutually exclusive. For event studies, use explicit stock entities, market.adjusted_close simple_return on an index or ETF benchmark, a prespecified window, market_adjusted returns, keep_first overlap handling, and event_trade_date clustered inference. The tool produces a structured research result and deterministic conclusion level; final prose must preserve that level and must not invent numbers.',
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
        : result.kind === 'multivariate_time_series_relationship'
          ? {
              rSquared: result.rSquared,
              adjustedRSquared: result.adjustedRSquared,
              coefficients: result.coefficients,
              residualLag1Autocorrelation: result.residualLag1Autocorrelation,
            }
          : result.kind === 'distribution_comparison'
            ? {
                groups: result.groups.map((group) => ({
                  inputId: group.inputId,
                  label: group.label,
                  summary: group.summary,
                })),
                comparison: result.comparison,
              }
            : {
                eventWindow: result.eventWindow,
                aggregate: result.aggregate,
                eventSample: result.events,
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
