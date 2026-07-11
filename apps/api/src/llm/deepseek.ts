// DeepSeek client — the official openai SDK pointed at DeepSeek's OpenAI-compatible endpoint.
// chatJson (forced JSON) backs NL→screen; chatText (free text) backs naming and other plain replies.
// Config from .env: DEEPSEEK_API_KEY (required), DEEPSEEK_MODEL, DEEPSEEK_BASE_URL.
import OpenAI from 'openai';
import type { ChatMessage, LlmCall } from './nl-to-structured.js';
import type { AgentLlm, ToolAwareMessage } from './agent-llm.js';

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

let _client: OpenAI | null = null;

export function deepseek(): OpenAI {
  if (_client) {
    return _client;
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY (.env)');
  }
  _client = new OpenAI({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE });
  return _client;
}

/** One chat completion forcing JSON output; returns raw message.content. Shape matches LlmCall so it
 * can be passed straight into nlToIr (production default; tests inject a mock instead). */
export const chatJson: LlmCall = async (messages: ChatMessage[]): Promise<string> => {
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  const res = await deepseek().chat.completions.create({
    model,
    messages,
    temperature: 0, // NL→structured needs determinism
    response_format: { type: 'json_object' },
  });
  const content = res.choices[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek returned empty content');
  }
  return content;
};

/** One chat completion returning free text (naming, etc.). Same LlmCall shape as chatJson. */
export const chatText: LlmCall = async (messages: ChatMessage[]): Promise<string> => {
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  const res = await deepseek().chat.completions.create({ model, messages, temperature: 0 });
  const content = res.choices[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek returned empty content');
  }
  return content;
};

function toOpenAiMessages(messages: ToolAwareMessage[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((message): OpenAI.ChatCompletionMessageParam => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant') {
      const assistantMessage = {
        role: 'assistant',
        content: message.content,
        ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: call.args },
              })),
            }
          : {}),
      };
      return assistantMessage as OpenAI.ChatCompletionAssistantMessageParam;
    }
    return { role: message.role, content: message.content };
  });
}

/** One tool-aware chat completion — the unified agent's production LlmCall (tests inject a scripted
 * mock instead). Empty `tools` = a plain completion (repair rounds run with tools disabled).
 * Always streams upstream: text tokens forward through opts.onDelta (when given) for the SSE path;
 * incremental tool_call fragments are accumulated by index and returned whole at the end. */
export const chatTools: AgentLlm = async (messages, tools, opts) => {
  const model = process.env.DEEPSEEK_AGENT_MODEL ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  const thinking = process.env.DEEPSEEK_AGENT_THINKING !== 'false';
  const reasoningEffort = process.env.DEEPSEEK_REASONING_EFFORT ?? 'high';
  const request = {
    model,
    stream: true as const,
    messages: toOpenAiMessages(messages),
    ...(thinking
      ? {
          reasoning_effort: reasoningEffort,
          thinking: { type: 'enabled' },
        }
      : { temperature: 0 }),
    ...(tools.length
      ? {
          tools: tools.map((tool) => ({
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }
      : {}),
  };
  const stream = await deepseek().chat.completions.create(
    request as OpenAI.ChatCompletionCreateParamsStreaming,
    { signal: opts?.signal },
  );

  let text = '';
  let reasoningContent = '';
  const toolCalls: { id: string; name: string; args: string }[] = [];
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) {
      continue;
    }
    if (delta.content) {
      text += delta.content;
      opts?.onDelta?.(delta.content);
    }
    const reasoningDelta = (delta as typeof delta & { reasoning_content?: string })
      .reasoning_content;
    if (reasoningDelta) {
      reasoningContent += reasoningDelta;
      opts?.onReasoningDelta?.(reasoningDelta);
    }
    for (const fragment of delta.tool_calls ?? []) {
      const slot = (toolCalls[fragment.index] ??= { id: '', name: '', args: '' });
      if (fragment.id) {
        slot.id = fragment.id;
      }
      if (fragment.function?.name) {
        slot.name = fragment.function.name;
      }
      if (fragment.function?.arguments) {
        slot.args += fragment.function.arguments;
      }
    }
  }

  const calls = toolCalls.filter((call) => call.name);
  return {
    text: text || undefined,
    reasoningContent: reasoningContent || undefined,
    toolCalls: calls.length ? calls : undefined,
  };
};
