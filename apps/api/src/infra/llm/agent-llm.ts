/**
 * Tool-aware LLM call shape for the unified agent (docs/design/unified-agent.md design 2). LlmCall
 * Plain completion calls remain available for metadata and naming; the agent core uses AgentLlm so
 * the model can request whitelisted read-only tools. The implementation lives in deepseek.ts (chatTools);
 * tests inject a scripted mock.
 */

/**
 * 承载模型返回的工具名称及原始 JSON 参数，交由工具解析与 zod 校验。
 *
 * What the model sends to a tool: the raw JSON arguments string (parsed + zod-validated by the tool).
 */
export interface ToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * 描述暴露给模型的工具 schema；可执行逻辑由 AgentTool 持有。
 *
 * The wire-facing part of a tool: what the model sees. The runnable part lives in AgentTool.
 */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema (generated from the tool's zod schema)
}

/**
 * 承载带工具调用及观察的模型消息，供统一对话循环传输。
 *
 * Represent model messages containing tool calls and observations in the unified turn loop.
 */
export type ToolAwareMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      reasoningContent?: string;
      toolCalls?: ToolCall[];
    }
  | { role: 'tool'; toolCallId: string; content: string };

/**
 * 封装模型文本、工具调用及用量，供 Agent 循环决定后续动作。
 *
 * Collect model text, tool calls and usage for the agent loop's next action.
 */
export interface AgentLlmReply {
  text?: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
}

/**
 * 配置工具感知模型请求的消息、工具和取消或流式回调。
 *
 * Configure messages, tools, cancellation and streaming for a tool-aware model request.
 */
export interface AgentLlmOpts {
  onDelta?: (text: string) => void; // streamed text tokens as they arrive (used for SSE forwarding)
  onReasoningDelta?: (text: string) => void;
  signal?: AbortSignal; // aborts the upstream completion (triggered by the cancel endpoint)
}

export type AgentLlm = (
  messages: ToolAwareMessage[],
  tools: ToolSpec[],
  opts?: AgentLlmOpts,
) => Promise<AgentLlmReply>;
