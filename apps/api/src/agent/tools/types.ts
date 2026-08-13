import type { ChartSpec, ResearchRunResultV1, UniverseSpecV1 } from '@jixie/shared';
import type { ToolSpec } from '../../llm/agent-llm.js';

/** A re-runnable point-in-time entity universe produced by the deterministic Universe executor. */
export interface AgentUniverse {
  title: string;
  spec: UniverseSpecV1;
}

/** A chart card draft: the query that draws it, never the points.
 * Produced as a side effect of the renderChart tool. */
export interface AgentChart {
  title: string;
  chart: ChartSpec;
}

/** A structured deterministic research result side-produced by executeResearchPlan. */
export interface AgentResearchRun {
  title: string;
  run: ResearchRunResultV1;
}

export interface ToolRunResult {
  observation: string; // what the model sees (JSON string, row-capped)
  rows?: number; // row count for the toolTrace
  universe?: AgentUniverse; // set when this call should surface a re-runnable entity universe
  chart?: AgentChart; // set when this call should surface a chart card in the reply
  research?: AgentResearchRun; // set when this call should surface a research result in the reply
}

export interface AgentToolRunContext {
  signal?: AbortSignal;
}

/** A whitelisted Agent tool. `run` re-validates args with zod (the JSON schema shown to the
 * model is generated from the same zod schema) and throws a human-readable error on bad input —
 * the core feeds it back as an observation so the model can fix its own arguments. */
export interface AgentTool extends ToolSpec {
  run(args: unknown, context?: AgentToolRunContext): Promise<ToolRunResult>;
}
