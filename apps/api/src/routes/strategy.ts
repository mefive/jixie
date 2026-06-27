import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '../lib/httpError.js';
import { chatText } from '../llm/deepseek.js';
import { nlToCode } from '../strategy/code/nl-to-code.js';

/**
 * Strategy authoring API. POST /api/app/strategy/codegen turns a natural-language description into a
 * compilable TS strategy module (the model writes code; we compile it to validate, with up to 2
 * self-correction rounds). The frontend drops the returned code into the editor for the user to review/run.
 */
export const strategyRoute = new Hono();

const codegenBody = z.object({ text: z.string().trim().min(1).max(800) });

strategyRoute.post('/codegen', validateJson(codegenBody), async (c) => {
  const { text } = c.req.valid('json');

  let result;
  try {
    result = await nlToCode(text, chatText);
  } catch (e) {
    // Missing key / upstream model failure — distinct from "model produced uncompilable code".
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : 'NL→code 调用失败');
  }

  if (!result.ok || !result.code) {
    return apiError(c, 'VALIDATION_FAILED', '没能把描述转成可编译的策略代码，请换个说法再试', {
      error: result.error,
    });
  }
  return c.json({ code: result.code, attempts: result.attempts });
});
