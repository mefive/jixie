/**
 * Tool-aware LLM call shape for the unified agent (docs/design/unified-agent.md 设计 2). LlmCall
 * (plain messages → string) stays for parseStructured / naming; the agent core uses AgentLlm so the
 * model can request whitelisted read-only tools. The implementation lives in deepseek.ts (chatTools);
 * tests inject a scripted mock.
 */

/** What the model sends to a tool: the raw JSON arguments string (parsed + zod-validated by the tool). */
export interface ToolCall {
  id: string;
  name: string;
  args: string;
}

/** The wire-facing part of a tool: what the model sees. The runnable part lives in AgentTool. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema (generated from the tool's zod schema)
}

export type ToolAwareMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface AgentLlmReply {
  text?: string;
  toolCalls?: ToolCall[];
}

export interface AgentLlmOpts {
  onDelta?: (text: string) => void; // streamed text tokens as they arrive (SSE 转发用)
  signal?: AbortSignal; // aborts the upstream completion (cancel 接口触发)
}

export type AgentLlm = (
  messages: ToolAwareMessage[],
  tools: ToolSpec[],
  opts?: AgentLlmOpts,
) => Promise<AgentLlmReply>;
