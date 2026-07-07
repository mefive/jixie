import {
  messageText,
  type ChatMessage as UiMessage,
  type MessagePart,
  type ToolTraceItem,
} from '@jixie/shared';
import type { AgentLlm, ToolAwareMessage, ToolCall } from '../llm/agent-llm.js';
import type { AgentCard, AgentChart, AgentTool } from './tools/types.js';

/**
 * Unified agent core (设计:docs/design/unified-agent.md). One turn loop shared by every agent
 * surface (strategy lab / factor / screen / Q&A); what varies per surface lives in an AgentProfile:
 * the system prompt, the read-only tool set, and — when the conversation produces code — the
 * artifact validator. A turn's lifecycle is fixed: tool rounds first (≤ MAX_TOOL_ROUNDS, observations
 * fed back), then the produce step, then compile-repair rounds with tools disabled. Tool messages
 * live only inside the turn — they are never persisted into the conversation.
 */
export interface AgentProfile {
  system: string; // full system prompt (codegen prompt + conversation-mode addendum, or a Q&A brief)
  tools?: AgentTool[]; // whitelisted read-only tools (empty/absent = plain chat)
  artifact?: {
    noun: string; // '策略' | '因子' — used in the current-code wrapper and repair messages
    validate(code: string): Promise<void>; // throws with a human-readable message when the code won't compile
  };
}

export type { ToolTraceItem };

/** Optional streaming hooks (the SSE path wires these to the turn bus; sync callers omit them).
 * onDelta fires for tool-phase / produce-phase text only — repair rounds are silent (their output is
 * just code); onRepair announces each retry instead. `signal` aborts between LLM calls AND the
 * in-flight upstream completion (chatTools passes it through). */
export interface AgentTurnHooks {
  signal?: AbortSignal;
  onDelta?(text: string): void;
  onToolStart?(name: string, argsSummary: string): void;
  onToolDone?(item: ToolTraceItem): void;
  onRepair?(round: number, error: string): void;
}

export interface AgentTurnResult {
  reply: string; // the assistant's human-readable explanation (code fence stripped out)
  code: string; // the artifact code after this turn — unchanged if the turn produced none
  changed: boolean; // whether `code` was replaced (a fenced block that validated)
  attempts: number; // model calls made (tool rounds + produce + compile-repair rounds)
  error?: string; // set when a proposed change wouldn't compile (code kept unchanged)
  toolTrace: ToolTraceItem[]; // every tool call this turn — display/debug only, never persisted
  cards: AgentCard[]; // query cards side-produced by runScreen tool calls this turn
  charts: AgentChart[]; // chart cards side-produced by renderChart tool calls this turn
}

/** Hard cap on tool-executing rounds per turn; after that the model must answer with what it has. */
const MAX_TOOL_ROUNDS = 5;

/** A turn result as the assistant message's parts: the explanation text + any query/chart cards the
 * tools side-produced. This is what routes return and the frontend appends + persists. */
export function turnParts(result: AgentTurnResult): MessagePart[] {
  return [
    { type: 'text', text: result.reply },
    ...result.cards.map(
      (card): MessagePart => ({ type: 'card', title: card.title, spec: card.spec }),
    ),
    ...result.charts.map(
      (chart): MessagePart => ({ type: 'chart', title: chart.title, chart: chart.chart }),
    ),
  ];
}

// Conversation-mode addendum layered over a one-shot codegen prompt — it flips the output contract
// from "code only, no prose" to "short explanation + full code in a fence", which the chat UI needs.
export function buildAgentMode(noun: string): string {
  return `
# 对话模式(重要,覆盖上面的「输出要求」)
你在和用户多轮对话,迭代改进「当前${noun}代码」。每轮:
- 先用**一两句中文**说清你做了什么改动(或为什么不改),别长篇大论。
- 若要改代码,在说明之后输出**完整**的${noun}模块(不是片段,是可直接替换编辑器的整份),包在 \`\`\`ts 围栏里。
- 若用户只是提问、或无需改代码,就只回答,**不要**输出围栏。
- 增量改「当前${noun}代码」,别推倒重来丢掉已有逻辑(除非用户明确要求重写)。
- 守住能力边界:做不到就说清缺什么数据/能力,**不要**硬输出代码。`;
}

// Appended to a profile's system prompt when it carries tools.
export const TOOLS_HINT = `
# 工具
你可以调用只读数据工具(查标的 / 查数据覆盖 / 按指标筛选最新快照 / 只读 SQL 做统计聚合与时序、财务查询 / 画图表)。涉及库里的事实时**先查再答**,不要臆造;工具结果只反映本地库的当前状态。不需要数据时不必调用。简单筛选优先 runScreen(结果自动成为用户可复用的查询卡片),它表达不了的才用 sqlQuery;趋势/对比/分布类适合看图的结论用 renderChart 直接画给用户。`;

/** The fenced ```ts block, or null when the reply has none (a pure answer). */
function extractFenced(text: string): string | null {
  const fenced = text.match(/```(?:ts|typescript|js|javascript)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : null;
}

/** The human-readable part of a reply = the text with the code fence removed. */
function stripFence(text: string): string {
  return text.replace(/```(?:ts|typescript|js|javascript)?\s*[\s\S]*?```/i, '').trim();
}

/** Pull the code out of a repair-round reply — tolerates fences / prose, else uses it whole. */
function extractRepairCode(text: string): string {
  const fenced = text.match(/```(?:ts|typescript|js|javascript)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Execute one requested tool call; failures (unknown tool, bad JSON, zod rejection, runtime error)
 * become observations too, so the model can correct itself instead of the turn dying. */
async function executeToolCall(
  tools: AgentTool[],
  call: ToolCall,
): Promise<{ observation: string; trace: ToolTraceItem; card?: AgentCard; chart?: AgentChart }> {
  const startedAt = Date.now();
  const argsSummary = (call.args || '{}').slice(0, 200);
  const fail = (observation: string) => ({
    observation,
    trace: { name: call.name, argsSummary, ok: false, ms: Date.now() - startedAt },
  });

  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return fail(`未知工具 ${call.name},可用:${tools.map((t) => t.name).join('、')}`);
  }

  let args: unknown;
  try {
    args = JSON.parse(call.args || '{}');
  } catch {
    return fail('参数不是合法 JSON,请修正后重试');
  }

  try {
    const result = await tool.run(args);
    return {
      observation: result.observation,
      card: result.card,
      chart: result.chart,
      trace: {
        name: call.name,
        argsSummary,
        ok: true,
        rows: result.rows,
        ms: Date.now() - startedAt,
      },
    };
  } catch (e) {
    return fail(`工具执行失败:${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * One agent turn: given the prior conversation + the current artifact code + a new user message, the
 * model may first query the whitelisted tools, then replies with a short explanation and (when a
 * change is warranted) the full updated code. A proposed change is validated by the profile's
 * artifact validator, feeding errors back for ≤ maxRepairs rounds; if it still won't compile we keep
 * the working code untouched and say so, rather than clobber it with something broken. Profiles
 * without an artifact answer as plain Q&A after the tool phase.
 */
export async function agentTurn(
  profile: AgentProfile,
  history: UiMessage[],
  message: string,
  currentCode: string,
  llm: AgentLlm,
  opts: { maxRepairs?: number; hooks?: AgentTurnHooks } = {},
): Promise<AgentTurnResult> {
  const { maxRepairs = 2, hooks } = opts;
  const { artifact } = profile;
  const throwIfAborted = () => {
    if (hooks?.signal?.aborted) {
      const abort = new Error('turn cancelled');
      abort.name = 'AbortError';
      throw abort;
    }
  };
  const tools = profile.tools ?? [];
  const userContent = artifact
    ? `当前${artifact.noun}代码:\n\`\`\`ts\n${currentCode}\n\`\`\`\n\n用户:${message}`
    : message;
  const messages: ToolAwareMessage[] = [
    { role: 'system', content: profile.system },
    ...history.map((turn): ToolAwareMessage => ({ role: turn.role, content: messageText(turn) })),
    { role: 'user', content: userContent },
  ];

  // Tool phase → produce: let the model query tools (≤ MAX_TOOL_ROUNDS rounds), then take its text.
  const toolTrace: ToolTraceItem[] = [];
  const cards: AgentCard[] = [];
  const charts: AgentChart[] = [];
  let attempts = 0;
  let raw = '';
  let toolRounds = 0;
  for (;;) {
    throwIfAborted();
    const allowTools = tools.length > 0 && toolRounds < MAX_TOOL_ROUNDS;
    const res = await llm(messages, allowTools ? tools : [], {
      onDelta: hooks?.onDelta,
      signal: hooks?.signal,
    });
    attempts++;
    if (allowTools && res.toolCalls?.length) {
      toolRounds++;
      messages.push({ role: 'assistant', content: res.text ?? null, toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        throwIfAborted();
        hooks?.onToolStart?.(call.name, (call.args || '{}').slice(0, 200));
        const executed = await executeToolCall(tools, call);
        toolTrace.push(executed.trace);
        hooks?.onToolDone?.(executed.trace);
        if (executed.card) {
          cards.push(executed.card);
        }
        if (executed.chart) {
          charts.push(executed.chart);
        }
        messages.push({ role: 'tool', toolCallId: call.id, content: executed.observation });
      }
      if (toolRounds >= MAX_TOOL_ROUNDS) {
        messages.push({ role: 'user', content: '工具调用轮数已达上限,请基于已有信息直接回答。' });
      }
      continue;
    }
    raw = res.text ?? '';
    break;
  }

  // No artifact → plain Q&A: the reply verbatim (it may legitimately contain markdown fences).
  if (!artifact) {
    return {
      reply: raw.trim(),
      code: currentCode,
      changed: false,
      attempts,
      toolTrace,
      cards,
      charts,
    };
  }

  const reply = stripFence(raw) || '(已更新代码)';
  let code = extractFenced(raw);
  // No code block → a pure answer / question; leave the current code as-is.
  if (!code) {
    return { reply, code: currentCode, changed: false, attempts, toolTrace, cards, charts };
  }

  // Repair phase: validate the proposed change, feeding compile errors back — tools stay disabled
  // and repair rounds don't stream deltas (their output is just code; onRepair announces the retry).
  let lastError = '';
  for (let round = 0; round <= maxRepairs; round++) {
    if (round > 0) {
      throwIfAborted();
      const repairRaw = await llm(messages, [], { signal: hooks?.signal });
      attempts++;
      code = extractRepairCode(repairRaw.text ?? '');
    }

    try {
      await artifact.validate(code);
      return { reply, code, changed: true, attempts, toolTrace, cards, charts };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (round < maxRepairs) {
        hooks?.onRepair?.(round + 1, lastError);
      }
      messages.push({ role: 'assistant', content: code });
      messages.push({
        role: 'user',
        content: `上面的代码无法编译/运行:${lastError}。请只输出完整、可编译的 TS ${artifact.noun}模块(可省略解释、不要 markdown 围栏)。`,
      });
    }
  }

  // Ran out of repair rounds — keep the working code, tell the user the change didn't land.
  return {
    reply: `${reply}\n\n(⚠️ 生成的改动没能通过编译,已保留原代码;换个说法再试。错误:${lastError})`,
    code: currentCode,
    changed: false,
    attempts,
    error: lastError,
    toolTrace,
    cards,
    charts,
  };
}
