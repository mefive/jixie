import type { ChatMessage, LlmCall } from '../../llm/nl-to-structured.js';
import { compileStrategy } from './compile.js';
import { buildCodegenPrompt } from './codegen-prompt.js';

export interface NlToCodeResult {
  ok: boolean;
  code?: string;
  attempts: number; // model calls actually made
  error?: string; // compile error (ok=false) or the reason when refused
  refused?: boolean; // model said the request is out of capability (vs a compile failure)
}

export interface NlToCodeOpts {
  maxRepairs?: number;
  availableIndices?: string; // formatted "CSI 300=000300.SH, …" — only the indices actually synced
  syncedIndices?: string[]; // the index codes whose constituents exist (for the deterministic check below)
}

/** Index codes the code passes to universe()/indexMembers() — used to reject unsynced indices deterministically
 * (the model sometimes writes a faithful-but-unavailable code instead of refusing). The suffix is 2–3 letters
 * (SH/SZ/BJ, and CSI for China Securities Index codes e.g. 932000.CSI). */
export function referencedIndices(code: string): string[] {
  const out = new Set<string>();
  const re = /(?:universe|indexMembers)\s*\(\s*['"]([0-9]{6}\.[A-Za-z]{2,3})['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out.add(m[1].toUpperCase());
  }
  return [...out];
}

/** Pull the code out of a model reply — tolerates ```ts fences / surrounding prose, else uses it whole. */
export function extractCode(text: string): string {
  const fenced = text.match(/```(?:ts|typescript|js|javascript)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** A "CANNOT: <reason>" reply means the request needs data/capabilities we don't have — surface the
 * reason instead of compiling. Returns the reason, or null if it's not a refusal. */
export function refusalReason(code: string): string | null {
  const m = code.match(/^CANNOT[:：]\s*([\s\S]*)/i);
  return m ? m[1].trim() : null;
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
  opts: NlToCodeOpts = {},
): Promise<NlToCodeResult> {
  const { maxRepairs = 2, availableIndices, syncedIndices } = opts;
  const messages: ChatMessage[] = [
    { role: 'system', content: buildCodegenPrompt(availableIndices) },
    { role: 'user', content: prompt },
  ];

  let attempts = 0;
  let lastError = '';
  for (let i = 0; i <= maxRepairs; i++) {
    const raw = await llm(messages);
    attempts++;
    const code = extractCode(raw);

    // The model declined — the request needs data/capabilities we don't have. Don't try to compile.
    const refused = refusalReason(code);
    if (refused) {
      return { ok: false, refused: true, error: refused, attempts };
    }

    try {
      await compileStrategy(code); // parses + loads + has onBar
      // Faithful but unrunnable: the code names an index whose constituents aren't synced. Refuse
      // upfront (deterministic) rather than hand back code that errors at backtest.
      if (syncedIndices) {
        const bad = referencedIndices(code).filter((ic) => !syncedIndices.includes(ic));
        if (bad.length) {
          return {
            ok: false,
            refused: true,
            attempts,
            error: `Used index(es) whose constituents aren't synced: ${bad.join(', ')}. Available indices: ${availableIndices ?? 'none'}.`,
          };
        }
      }
      return { ok: true, code, attempts };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: `The strategy code above failed to compile/run: ${lastError}. Please fix it and output only the complete TS strategy module (export default defineStrategy({ … })), with no explanation and no markdown fences.`,
      });
    }
  }

  return { ok: false, attempts, error: lastError };
}
