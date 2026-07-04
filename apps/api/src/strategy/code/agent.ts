import type { ChatMessage as UiMessage } from '@jixie/shared';
import type { ChatMessage, LlmCall } from '../../llm/nl-to-structured.js';
import { compileStrategy } from './compile.js';
import { extractCode } from './nl-to-code.js';
import { buildCodegenPrompt } from './codegen-prompt.js';

export interface AgentTurnResult {
  reply: string; // the assistant's human-readable explanation (code fence stripped out)
  code: string; // the strategy code after this turn — unchanged if the turn produced none
  changed: boolean; // whether `code` was replaced (a fenced block that compiled)
  attempts: number; // model calls made (1 + compile-repair rounds)
  error?: string; // set when a proposed change wouldn't compile (code kept unchanged)
}

// Conversation-mode addendum layered over the one-shot codegen prompt — it flips the output contract
// from "code only, no prose" to "short explanation + full code in a fence", which the chat UI needs.
const AGENT_MODE = `
# 对话模式(重要,覆盖上面的「输出要求」)
你在和用户多轮对话,迭代改进「当前策略代码」。每轮:
- 先用**一两句中文**说清你做了什么改动(或为什么不改),别长篇大论。
- 若要改代码,在说明之后输出**完整**的策略模块(不是片段,是可直接替换编辑器的整份),包在 \`\`\`ts 围栏里。
- 若用户只是提问、或无需改代码,就只回答,**不要**输出围栏。
- 增量改「当前策略代码」,别推倒重来丢掉已有逻辑(除非用户明确要求重写)。
- 守住能力边界:做不到就说清缺什么数据/能力,**不要**硬输出代码。`;

function buildAgentSystem(availableIndices?: string): string {
  return `${buildCodegenPrompt(availableIndices)}\n${AGENT_MODE}`;
}

/** The fenced ```ts block, or null when the reply has none (a pure answer). */
function extractFenced(text: string): string | null {
  const fenced = text.match(/```(?:ts|typescript|js|javascript)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : null;
}

/** The human-readable part of a reply = the text with the code fence removed. */
function stripFence(text: string): string {
  return text.replace(/```(?:ts|typescript|js|javascript)?\s*[\s\S]*?```/i, '').trim();
}

/**
 * One agent turn: given the prior conversation + the current strategy code + a new user message, the
 * model replies with a short explanation and (when a change is warranted) the full updated code. We
 * compile-validate a proposed change, feeding errors back for ≤ maxRepairs rounds; if it still won't
 * compile we keep the working code untouched and say so, rather than clobber it with something broken.
 */
export async function agentTurn(
  history: UiMessage[],
  message: string,
  currentCode: string,
  llm: LlmCall,
  opts: { maxRepairs?: number; availableIndices?: string } = {},
): Promise<AgentTurnResult> {
  const { maxRepairs = 2, availableIndices } = opts;
  const messages: ChatMessage[] = [
    { role: 'system', content: buildAgentSystem(availableIndices) },
    ...history.map((turn): ChatMessage => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: `当前策略代码:\n\`\`\`ts\n${currentCode}\n\`\`\`\n\n用户:${message}` },
  ];

  let attempts = 0;
  let reply = '';
  let code: string | null = null;
  let lastError = '';
  for (let round = 0; round <= maxRepairs; round++) {
    const raw = await llm(messages);
    attempts++;
    if (round === 0) {
      reply = stripFence(raw) || '(已更新代码)';
      code = extractFenced(raw);
      // No code block → a pure answer / question; leave the current code as-is.
      if (!code) {
        return { reply, code: currentCode, changed: false, attempts };
      }
    } else {
      code = extractCode(raw); // repair rounds return just the corrected module
    }

    try {
      await compileStrategy(code);
      return { reply, code, changed: true, attempts };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: `上面的代码无法编译/运行:${lastError}。请只输出完整、可编译的 TS 策略模块(可省略解释、不要 markdown 围栏)。`,
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
  };
}
