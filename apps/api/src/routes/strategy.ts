import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { ulid } from 'ulid';
import { chatText } from '../llm/deepseek.js';
import { strategyProfile } from '../agent/profiles/strategy.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { KNOWN_INDICES } from '../strategy/code/codegen-prompt.js';

/**
 * Strategy authoring API. POST /api/app/strategy/agent runs one turn of the code Agent (iterates on the
 * strategy code given the conversation + current code); POST /api/app/strategy/name proposes a name from
 * a prompt or the code. The frontend applies the returned code to the editor.
 */
export const strategyRoute = new Hono();

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

// POST /api/app/strategy/agent — START one turn of the strategy Agent and return a turnId
// immediately; the turn runs in the background (subscribe via GET /api/app/agent/turns/:id/stream).
// History comes from the strategy row (the runner persists both the user message and the reply),
// so the strategy must exist before the first turn (the frontend creates it up front).
const agentBody = z.object({
  id: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
  code: z.string().min(1).max(50_000),
});

strategyRoute.post('/agent', validateJson(agentBody), async (c) => {
  const { id, message, code } = c.req.valid('json');
  const userId = c.var.userId;
  const strategy = await prisma.strategy.findFirst({ where: { id, userId }, select: { id: true } });
  if (!strategy) {
    return apiError(c, 'NOT_FOUND', '策略不存在');
  }
  const entity = { kind: 'strategy' as const, id };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', '该策略已有正在进行的回复,请等它结束或取消');
  }

  const idx = await syncedIndices();
  const turnId = ulid();
  enqueueAgentTurn({
    turnId,
    userId,
    profile: strategyProfile(idx.text),
    entity,
    message,
    currentCode: code,
  });
  return c.json({ turnId });
});

// POST /api/app/strategy/name — the model proposes a short Chinese strategy name. Two modes:
//  - {prompt}: name a brand-new strategy from the user's natural-language request (before any code);
//  - {code, currentName?}: name from the code — if currentName still fits, keep it (only rename when
//    the strategy's logic has drifted). Used on each run so the name tracks the code without churning.
const nameBody = z
  .object({
    code: z.string().max(50_000).optional(),
    prompt: z.string().max(2000).optional(),
    currentName: z.string().max(100).optional(),
  })
  .refine((body) => body.code || body.prompt, { message: '需要 code 或 prompt' });

strategyRoute.post('/name', validateJson(nameBody), async (c) => {
  const { code, prompt, currentName } = c.req.valid('json');
  let name: string;
  try {
    const messages =
      code != null
        ? [
            {
              role: 'system' as const,
              content: currentName
                ? `你是 A 股策略命名助手。读策略代码,它当前叫「${currentName}」。若这个名称仍准确概括代码的选股/择时/交易逻辑,就**原样返回它**;只有当逻辑已明显不符时,才起一个更贴切的简短中文名(≤14字)。只输出名称本身——不要引号、不要解释、不要结尾标点。`
                : '你是 A 股策略命名助手。读策略代码,起一个简短中文名称(≤14字,概括其选股/择时/交易逻辑),只输出名称本身——不要引号、不要解释、不要结尾标点。',
            },
            { role: 'user' as const, content: code },
          ]
        : [
            {
              role: 'system' as const,
              content:
                '你是 A 股策略命名助手。读用户的自然语言策略需求,起一个简短中文名称(≤14字,概括其选股/择时/交易意图),只输出名称本身——不要引号、不要解释、不要结尾标点。',
            },
            { role: 'user' as const, content: prompt! },
          ];
    const raw = await chatText(messages);
    name = raw
      .trim()
      .replace(/^["'「『]+|["'」』。.]+$/g, '')
      .slice(0, 20);
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : '命名失败');
  }
  return c.json({ name: name || '未命名策略' });
});
