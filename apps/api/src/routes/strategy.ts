import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { chatText } from '../llm/deepseek.js';
import { nlToCode } from '../strategy/code/nl-to-code.js';
import { agentTurn } from '../strategy/code/agent.js';
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
  const present = await prisma.indexWeight.findMany({
    select: { indexCode: true },
    distinct: ['indexCode'],
  });
  const codes = present.map((r) => r.indexCode).filter((cc) => KNOWN_INDICES[cc]);
  const text = codes.length
    ? codes.map((cc) => `${KNOWN_INDICES[cc]}=${cc}`).join('、')
    : '(暂未收录任何指数成分)';
  return { codes, text };
}

strategyRoute.post('/codegen', validateJson(codegenBody), async (c) => {
  const { text } = c.req.valid('json');

  let result;
  try {
    const idx = await syncedIndices();
    result = await nlToCode(text, chatText, {
      availableIndices: idx.text,
      syncedIndices: idx.codes,
    });
  } catch (e) {
    // Missing key / upstream model failure — distinct from "model produced uncompilable code".
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : 'NL→code 调用失败');
  }

  // The model declined — the request is out of capability. Surface the reason (not a "failed" framing).
  if (result.refused) {
    return apiError(c, 'VALIDATION_FAILED', `这个需求暂时做不到：${result.error ?? ''}`, {
      refused: true,
    });
  }
  if (!result.ok || !result.code) {
    return apiError(c, 'VALIDATION_FAILED', '没能把描述转成可编译的策略代码，请换个说法再试', {
      error: result.error,
    });
  }
  return c.json({ code: result.code, attempts: result.attempts });
});

// POST /api/app/strategy/agent — one turn of the strategy Agent: iterate on the current code given the
// conversation so far. Returns the assistant's explanation + the (compile-validated) updated code. The
// frontend owns the conversation (appends the turn, persists messages onto the strategy).
const agentBody = z.object({
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(60)
    .default([]),
  message: z.string().trim().min(1).max(2000),
  code: z.string().min(1).max(50_000),
});

strategyRoute.post('/agent', validateJson(agentBody), async (c) => {
  const { history, message, code } = c.req.valid('json');
  try {
    const idx = await syncedIndices();
    const result = await agentTurn(history, message, code, chatText, {
      availableIndices: idx.text,
    });
    return c.json({
      reply: result.reply,
      code: result.code,
      changed: result.changed,
      attempts: result.attempts,
    });
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : 'Agent 调用失败');
  }
});

// POST /api/app/strategy/name — let the model read the code and propose a short Chinese name (used when
// 策略名称 is left blank; the user can still edit it).
const nameBody = z.object({ code: z.string().min(1).max(50_000) });

strategyRoute.post('/name', validateJson(nameBody), async (c) => {
  const { code } = c.req.valid('json');
  let name: string;
  try {
    const raw = await chatText([
      {
        role: 'system',
        content:
          '你是 A 股策略命名助手。读用户的策略代码,起一个简短中文名称(≤14字,概括其选股/择时/交易逻辑),只输出名称本身——不要引号、不要解释、不要结尾标点。',
      },
      { role: 'user', content: code },
    ]);
    name = raw
      .trim()
      .replace(/^["'「『]+|["'」』。.]+$/g, '')
      .slice(0, 20);
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : '命名失败');
  }
  return c.json({ name: name || '未命名策略' });
});
