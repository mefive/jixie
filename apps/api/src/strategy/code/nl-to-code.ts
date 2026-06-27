import type { ChatMessage, LlmCall } from '../../llm/nl-to-structured.js';
import { compileStrategy } from './compile.js';
import { buildCodegenPrompt } from './codegen-prompt.js';

export interface NlToCodeResult {
  ok: boolean;
  code?: string;
  attempts: number; // model calls actually made
  error?: string; // last compile error when ok=false
}

/** Pull the code out of a model reply — tolerates ```ts fences / surrounding prose, else uses it whole. */
export function extractCode(text: string): string {
  const fenced = text.match(/```(?:ts|typescript|js|javascript)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * NL→strategy code: the model writes a TS module, which we *compile* to validate (esbuild parse + load +
 * an onBar export). A compile error is fed back so the model self-corrects (≤ maxRepairs). Compiling is a
 * stronger check than schema validation was — it rejects anything that won't even load — while logic bugs
 * are still found by actually running the backtest. The LLM call is injected (mockable, no key in tests).
 */
export async function nlToCode(
  prompt: string,
  llm: LlmCall,
  maxRepairs = 2,
): Promise<NlToCodeResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildCodegenPrompt() },
    { role: 'user', content: prompt },
  ];

  let attempts = 0;
  let lastError = '';
  for (let i = 0; i <= maxRepairs; i++) {
    const raw = await llm(messages);
    attempts++;
    const code = extractCode(raw);

    try {
      await compileStrategy(code); // parses + loads + has onBar
      return { ok: true, code, attempts };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: `上面的策略代码无法编译/运行:${lastError}。请修正,只输出完整的 TS 策略模块(export default defineStrategy({ … })),不要解释、不要 markdown 围栏。`,
      });
    }
  }

  return { ok: false, attempts, error: lastError };
}
