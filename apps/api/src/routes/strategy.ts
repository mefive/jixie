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
import { localeFromRequest } from '../i18n/index.js';

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

// POST /api/app/strategy/name — the model proposes a short strategy name in the user's language. Two modes:
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

  // The generated name is user-facing, so its language follows the request locale.
  const nameLangHint =
    localeFromRequest(c) === 'en'
      ? 'a short English name (≤5 words)'
      : 'a short Chinese name (≤14 chars)';

  let name: string;
  try {
    const messages =
      code != null
        ? [
            {
              role: 'system' as const,
              content: currentName
                ? `You name A-share strategies. Read the strategy code; it is currently called "${currentName}". If that name still accurately summarizes the code's selection/timing/trading logic, **return it unchanged**; only when the logic has clearly drifted, propose a more fitting ${nameLangHint}. Output only the name itself — no quotes, no explanation, no trailing punctuation.`
                : `You name A-share strategies. Read the strategy code and propose ${nameLangHint} summarizing its selection/timing/trading logic. Output only the name itself — no quotes, no explanation, no trailing punctuation.`,
            },
            { role: 'user' as const, content: code },
          ]
        : [
            {
              role: 'system' as const,
              content: `You name A-share strategies. Read the user's natural-language strategy request and propose ${nameLangHint} summarizing its selection/timing/trading intent. Output only the name itself — no quotes, no explanation, no trailing punctuation.`,
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
