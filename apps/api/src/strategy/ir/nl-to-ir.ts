import type { StrategyIR } from '@jixie/shared';
import { parseStructured, type LlmCall } from '../../llm/nl-to-structured.js';
import { buildSystemPrompt } from './nl-prompt.js';
import { validateStrategyIR } from './schema.js';

// Re-export the shared NL plumbing so existing importers (deepseek client, tests) stay stable.
export { extractJson } from '../../llm/nl-to-structured.js';
export type { ChatMessage, LlmCall } from '../../llm/nl-to-structured.js';

export interface NlToIrResult {
  ok: boolean;
  ir?: StrategyIR;
  attempts: number;
  errors?: string[];
  raw?: string;
}

/** NL→strategy IR: model fills the blanks → re-validated against the IR schema (≤2 self-corrections). */
export async function nlToIr(prompt: string, llm: LlmCall, maxRepairs = 2): Promise<NlToIrResult> {
  const r = await parseStructured<StrategyIR>({
    systemPrompt: buildSystemPrompt(),
    userPrompt: prompt,
    validate: (o) => {
      const v = validateStrategyIR(o);
      return v.ok ? { ok: true, value: v.ir as StrategyIR } : { ok: false, errors: v.errors };
    },
    llm,
    noun: '策略 IR',
    maxRepairs,
  });
  return { ok: r.ok, ir: r.value, attempts: r.attempts, errors: r.errors, raw: r.raw };
}
