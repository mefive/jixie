import type { ScreenSpec } from '@jixie/shared';
import { parseStructured, type LlmCall } from '../llm/nl-to-structured.js';
import { buildScreenPrompt } from './nl-prompt.js';
import { validateScreenSpec } from './spec.js';

/** Either a metric screen (editable spec) or a direct instrument lookup (names/codes to resolve in DB). */
export type NlParse =
  | { kind: 'screen'; spec: ScreenSpec }
  | { kind: 'lookup'; names: string[] };

export interface NlToScreenResult {
  ok: boolean;
  parse?: NlParse;
  attempts: number;
  errors?: string[];
  raw?: string;
}

/** NL→(screen spec | lookup): model classifies + fills → re-validated (≤2 self-corrections). The lookup
 * branch only yields normalized *names* — codes are resolved against our own DB by the caller, never trusted
 * from the model. */
export async function nlToScreen(
  prompt: string,
  llm: LlmCall,
  maxRepairs = 2,
): Promise<NlToScreenResult> {
  const r = await parseStructured<NlParse>({
    systemPrompt: buildScreenPrompt(),
    userPrompt: prompt,
    validate: (o) => {
      // (B) lookup: { lookup: string[] }
      if (o && typeof o === 'object' && Array.isArray((o as { lookup?: unknown }).lookup)) {
        const names = ((o as { lookup: unknown[] }).lookup)
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim());
        return names.length
          ? { ok: true, value: { kind: 'lookup', names } }
          : { ok: false, errors: ['lookup 不能为空'] };
      }
      // (A) screen spec
      const v = validateScreenSpec(o);
      return v.ok ? { ok: true, value: { kind: 'screen', spec: v.spec } } : { ok: false, errors: v.errors };
    },
    llm,
    noun: '查询',
    maxRepairs,
  });
  return { ok: r.ok, parse: r.value, attempts: r.attempts, errors: r.errors, raw: r.raw };
}
