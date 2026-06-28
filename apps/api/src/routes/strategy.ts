import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { chatText } from '../llm/deepseek.js';
import { nlToCode } from '../strategy/code/nl-to-code.js';
import { KNOWN_INDICES } from '../strategy/code/codegen-prompt.js';

/**
 * Strategy authoring API. POST /api/app/strategy/codegen turns a natural-language description into a
 * compilable TS strategy module (the model writes code; we compile it to validate, with up to 2
 * self-correction rounds) — or refuses when the request needs data/capabilities the SDK lacks. The
 * frontend drops the returned code into the editor, or shows the refusal reason.
 */
export const strategyRoute = new Hono();

const codegenBody = z.object({ text: z.string().trim().min(1).max(800) });

/** The indices whose constituents are actually synced: the raw codes (for the deterministic check) +
 * a formatted string (for the prompt), so we never offer or accept an index we can't resolve. */
async function syncedIndices(): Promise<{ codes: string[]; text: string }> {
  const present = await prisma.indexWeight.findMany({ select: { indexCode: true }, distinct: ['indexCode'] });
  const codes = present.map((r) => r.indexCode).filter((cc) => KNOWN_INDICES[cc]);
  const text = codes.length ? codes.map((cc) => `${KNOWN_INDICES[cc]}=${cc}`).join('、') : '(暂未收录任何指数成分)';
  return { codes, text };
}

strategyRoute.post('/codegen', validateJson(codegenBody), async (c) => {
  const { text } = c.req.valid('json');

  let result;
  try {
    const idx = await syncedIndices();
    result = await nlToCode(text, chatText, { availableIndices: idx.text, syncedIndices: idx.codes });
  } catch (e) {
    // Missing key / upstream model failure — distinct from "model produced uncompilable code".
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : 'NL→code 调用失败');
  }

  // The model declined — the request is out of capability. Surface the reason (not a "failed" framing).
  if (result.refused) {
    return apiError(c, 'VALIDATION_FAILED', `这个需求暂时做不到：${result.error ?? ''}`, { refused: true });
  }
  if (!result.ok || !result.code) {
    return apiError(c, 'VALIDATION_FAILED', '没能把描述转成可编译的策略代码，请换个说法再试', {
      error: result.error,
    });
  }
  return c.json({ code: result.code, attempts: result.attempts });
});
