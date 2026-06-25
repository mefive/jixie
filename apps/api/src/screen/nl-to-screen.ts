import type { ScreenSpec } from '@jixie/shared';
import { parseStructured, type LlmCall } from '../llm/nl-to-structured.js';
import { buildScreenPrompt } from './nl-prompt.js';
import { validateScreenSpec } from './spec.js';

export interface NlToScreenResult {
  ok: boolean;
  spec?: ScreenSpec;
  attempts: number;
  errors?: string[];
  raw?: string;
}

/** NL→ScreenSpec: model fills the blanks → re-validated against the screen schema (≤2 self-corrections). */
export async function nlToScreen(
  prompt: string,
  llm: LlmCall,
  maxRepairs = 2,
): Promise<NlToScreenResult> {
  const r = await parseStructured<ScreenSpec>({
    systemPrompt: buildScreenPrompt(),
    userPrompt: prompt,
    validate: (o) => {
      const v = validateScreenSpec(o);
      return v.ok ? { ok: true, value: v.spec } : { ok: false, errors: v.errors };
    },
    llm,
    noun: '查询 spec',
    maxRepairs,
  });
  return { ok: r.ok, spec: r.value, attempts: r.attempts, errors: r.errors, raw: r.raw };
}
