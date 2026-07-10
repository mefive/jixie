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
import { BUILTIN_USER_ID } from '../factor/builtin-factors.js';
import { localeFromRequest, m } from '../i18n/index.js';
import { backtestRoute } from './backtest.js';

/**
 * Strategy workbench actions (singular, mounted at /api/app/strategy). POST /agent runs one turn of
 * the code Agent (iterates on the strategy code given the conversation + current code); POST /name
 * proposes a name from a prompt or the code; /backtest/* is the backtest Job (backtest.ts, mounted
 * here — symmetric with /factor/analysis). Resource CRUD lives in strategies.ts (plural).
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const strategyRoute = new Hono();

// Backtest runs on a strategy — its Job routes ride under the strategy workbench.
strategyRoute.route('/backtest', backtestRoute);

/** Formatted list of indices whose constituents are actually synced — only offer what we can resolve. */
async function syncedIndices(): Promise<string> {
  const present = await prisma.indexWeight.findMany({
    select: { indexCode: true },
    distinct: ['indexCode'],
  });
  const codes = present.map((r) => r.indexCode).filter((cc) => KNOWN_INDICES[cc]);
  return codes.length
    ? codes.map((cc) => `${KNOWN_INDICES[cc]}=${cc}`).join('、')
    : '(no index constituents on record yet)';
}

/** The finalized factors this user may reference as custom:<key> — own factors + builtin presets — formatted
 * for the codegen prompt (same pattern as syncedIndices: only offer what actually resolves). */
async function referencableFactors(userId: string): Promise<string> {
  const rows = await prisma.factor.findMany({
    where: { userId: { in: [userId, BUILTIN_USER_ID] }, key: { not: null } },
    select: { key: true, name: true, descriptionEn: true },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.length
    ? rows
        .map(
          (row) =>
            `${row.name}=custom:${row.key}${row.descriptionEn ? ` (${row.descriptionEn})` : ''}`,
        )
        .join('、')
    : '(none yet)';
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
    return apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
  }
  const entity = { kind: 'strategy' as const, id };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyTurnInProgress'));
  }

  const [idx, factors] = await Promise.all([syncedIndices(), referencableFactors(userId)]);
  const turnId = ulid();
  enqueueAgentTurn({
    turnId,
    userId,
    profile: strategyProfile(idx, factors),
    entity,
    message,
    currentCode: code,
    locale: localeFromRequest(c),
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
  .refine((body) => body.code || body.prompt, { message: 'code or prompt required' });

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
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : m(c, 'nameFailed'));
  }
  return c.json({ name: name || m(c, 'unnamedStrategy') });
});
