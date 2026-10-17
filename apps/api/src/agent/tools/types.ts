import type {
  ResearchCellChangeProposalV1,
  ResearchClarificationV1,
  UniverseSpecV1,
  EmbeddedAnalysisPart,
} from '@jixie/shared';
import type { ToolSpec } from '#infra/llm/agent-llm.js';

/**
 * 表示确定性执行器生成的可重跑时点证券池。
 *
 * A re-runnable point-in-time entity universe produced by the deterministic Universe executor.
 */
export interface AgentUniverse {
  title: string;
  spec: UniverseSpecV1;
}

/**
 * 组合工具观察和可持久化产物，供 Agent 对话循环消费。
 *
 * Combine a tool observation with durable artifacts consumed by the agent loop.
 */
export interface ToolRunResult {
  embeddedAnalysis?: EmbeddedAnalysisPart;
  observation: string; // what the model sees (JSON string, row-capped)
  rows?: number; // row count for the toolTrace
  universe?: AgentUniverse; // set when this call should surface a re-runnable entity universe
  researchCellChange?: ResearchCellChangeProposalV1; // pending proposal surfaced as a durable message part
  researchClarification?: ResearchClarificationV1; // durable semantic choice surfaced as a message part
}

/**
 * 提供单次工具执行的上下文及信号，供工具绑定当前对话轮次。
 *
 * Provide turn context and cancellation capabilities to a tool invocation.
 */
export interface AgentToolRunContext {
  signal?: AbortSignal;
  onEmbeddedAnalysis?(part: EmbeddedAnalysisPart): Promise<void>;
}

/**
 * 定义白名单 Agent 工具；运行时与模型 schema 共用 zod，执行前再次校验参数。
 *
 * A whitelisted Agent tool. `run` re-validates args with zod (the JSON schema shown to the
 * model is generated from the same zod schema) and throws a human-readable error on bad input —
 * the core feeds it back as an observation so the model can fix its own arguments.
 */
export interface AgentTool extends ToolSpec {
  run(args: unknown, context?: AgentToolRunContext): Promise<ToolRunResult>;
}
