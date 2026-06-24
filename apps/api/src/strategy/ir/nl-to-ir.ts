import type { StrategyIR } from '@jixie/shared';
import { buildSystemPrompt } from './nl-prompt.js';
import { validateStrategyIR } from './schema.js';

/**
 * NL→IR orchestration: call the model → parse JSON → validate against the IR schema → on failure feed
 * the errors back so the model self-corrects (≤ maxRepairs times). The LLM call is injected (llm
 * param) so this is unit-testable with a mock — no API key needed in tests. Pattern mirrors fangtu's
 * nl-to-spec.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type LlmCall = (messages: ChatMessage[]) => Promise<string>;

export interface NlToIrResult {
  ok: boolean;
  ir?: StrategyIR; // valid strategy IR when ok=true
  attempts: number; // number of model calls actually made
  errors?: string[]; // last validation/parse errors when ok=false
  raw?: string; // model's last raw output when ok=false (for debugging)
}

/** Extract a JSON object from model output (tolerates ```json fences / surrounding prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < 0 || end < start) throw new Error('未找到 JSON 对象');
  return JSON.parse(body.slice(start, end + 1));
}

export async function nlToIr(
  prompt: string,
  llm: LlmCall,
  maxRepairs = 2,
): Promise<NlToIrResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: prompt },
  ];

  let attempts = 0;
  let lastErrors: string[] = [];
  let lastRaw = '';
  for (let i = 0; i <= maxRepairs; i++) {
    const text = await llm(messages);
    attempts++;
    lastRaw = text;

    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch (e) {
      lastErrors = [`JSON 解析失败: ${(e as Error).message}`];
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `${lastErrors[0]}。请只输出一个合法的策略 IR JSON 对象,不要任何解释。`,
      });
      continue;
    }

    const v = validateStrategyIR(parsed);
    if (v.ok) return { ok: true, ir: v.ir as StrategyIR, attempts };

    lastErrors = v.errors;
    messages.push({ role: 'assistant', content: text });
    messages.push({
      role: 'user',
      content: `上面的策略 IR 校验失败:${v.errors.join('; ')}。请仅用白名单内的字段/算子/取值修正,只输出修正后的 IR JSON。`,
    });
  }

  return { ok: false, attempts, errors: lastErrors, raw: lastRaw };
}
