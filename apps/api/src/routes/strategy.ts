import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '../lib/httpError.js';
import { chatJson } from '../llm/deepseek.js';
import { nlToIr } from '../strategy/ir/nl-to-ir.js';

/**
 * Strategy authoring API. POST /api/app/strategy/parse turns a natural-language description into a
 * validated strategy IR (the model fills the blanks; output is re-validated against the IR schema,
 * with up to 2 self-correction rounds). The frontend reflects the returned IR into the config form.
 */
export const strategyRoute = new Hono();

const parseBody = z.object({ text: z.string().trim().min(1).max(500) });

strategyRoute.post('/parse', validateJson(parseBody), async (c) => {
  const { text } = c.req.valid('json');

  let result;
  try {
    result = await nlToIr(text, chatJson);
  } catch (e) {
    // Missing key / upstream model failure — distinct from "model produced invalid IR".
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : 'NL→IR 调用失败');
  }

  if (!result.ok) {
    return apiError(c, 'VALIDATION_FAILED', '没能把描述转成合法策略，请换个说法再试', {
      errors: result.errors,
    });
  }
  return c.json({ ir: result.ir, attempts: result.attempts });
});
