import type { ChartSpec, ScreenSpec } from '@jixie/shared';
import type { ToolSpec } from '../../llm/agent-llm.js';

/** A query card draft: the spec that produced a screen result (persisted, re-runnable — never the
 * result rows themselves). Produced as a side effect of the runScreen tool, consumed by the chat UI. */
export interface AgentCard {
  title: string;
  spec: ScreenSpec;
}

/** A chart card draft — same contract as AgentCard: the query that draws it, never the points.
 * Produced as a side effect of the renderChart tool. */
export interface AgentChart {
  title: string;
  chart: ChartSpec;
}

export interface ToolRunResult {
  observation: string; // what the model sees (JSON string, row-capped)
  rows?: number; // row count for the toolTrace
  card?: AgentCard; // set when this call should surface a query card in the reply
  chart?: AgentChart; // set when this call should surface a chart card in the reply
}

/** A whitelisted read-only tool. `run` re-validates args with zod (the JSON schema shown to the
 * model is generated from the same zod schema) and throws a human-readable error on bad input —
 * the core feeds it back as an observation so the model can fix its own arguments. */
export interface AgentTool extends ToolSpec {
  run(args: unknown): Promise<ToolRunResult>;
}
