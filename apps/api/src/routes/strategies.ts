import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import type { BacktestSummary, StrategyCard } from '@jixie/shared';

import { apiError, validateJson } from '../lib/httpError.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import { prisma } from '../lib/prisma.js';
import { codeConfigSchema } from '../strategy/code/schema.js';
import { localeFromRequest, m } from '../i18n/index.js';
import {
  commitStrategyConfig,
  proposeStrategyName,
  uniqueStrategyName,
} from '../services/strategy-service.js';

/**
 * Saved strategies (product line 1 persistence). Owner-scoped CRUD over the Strategy table. The workbench
 * is created before its first Agent turn or backtest, then the backtest use case commits runnable config
 * by id. Names are unique per user for display tidiness. Every query is scoped by userId, so another
 * user's id 404s.
 */
export const strategiesRoute = new Hono();

// GET /api/app/strategies — list the user's saved strategies + a compact last-run snapshot (sparkline +
// metrics) per card, newest first.
strategiesRoute.get('/', async (c) => {
  const rows = await prisma.strategy.findMany({
    where: { userId: c.var.userId },
    select: { id: true, name: true, createdAt: true, updatedAt: true, lastResult: true },
    orderBy: { updatedAt: 'desc' },
  });
  const cards: StrategyCard[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    snapshot: snapshotOf(r.lastResult),
  }));
  return c.json(cards);
});

/** Compact a stored BacktestSummary into a card snapshot: headline metrics + a downsampled equity curve. */
function snapshotOf(lastResult: unknown): StrategyCard['snapshot'] {
  const r = lastResult as BacktestSummary | null;
  if (!r || !Array.isArray(r.nav) || r.nav.length === 0) {
    return undefined;
  }
  const vals = r.nav.map((n) => n.value);
  const N = 48;
  const step = Math.max(1, Math.floor(vals.length / N));
  const spark = vals.filter((_, i) => i % step === 0);
  return { totalReturn: r.totalReturn, sharpe: r.sharpe, trades: r.trades, spark };
}

// GET /api/app/strategies/:id — full payload (to reopen in the workbench).
strategiesRoute.get('/:id', async (c) => {
  const row = await prisma.strategy.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
  }
  return c.json({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    config: row.config,
    lastResult: row.lastResult,
    messages: row.messages,
  });
});

// POST /api/app/strategies — create a NEW strategy row (created up front on the first Agent prompt, so
// the conversation has something to attach to). The Agent conversation rides along as an optional
// `messages` array. Config (code/range/capital) + name are the initial values; later they change only
// on a run (POST /:id), while messages save in real time.
const createBody = codeConfigSchema.extend({
  name: z.string().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(2000).optional(),
  messages: chatMessagesSchema.optional(),
});

strategiesRoute.post('/', validateJson(createBody), async (c) => {
  const { messages, prompt, ...candidate } = c.req.valid('json');
  const userId = c.var.userId;
  let proposedName = candidate.name;
  if (prompt || !proposedName) {
    try {
      proposedName = await proposeStrategyName({
        code: prompt ? undefined : candidate.code,
        prompt,
        locale: localeFromRequest(c),
      });
    } catch {
      proposedName = m(c, 'unnamedStrategy');
    }
  }
  const name = await uniqueStrategyName(prisma, userId, proposedName || m(c, 'unnamedStrategy'));
  const config = { ...candidate, name };
  const row = await prisma.strategy.create({
    data: {
      id: ulid(),
      userId,
      name,
      config: config as unknown as Prisma.InputJsonValue,
      ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}),
    },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  return c.json(row);
});

// POST /api/app/strategies/:id — update an existing strategy by id. `{ messages }` alone saves just the
// conversation (real-time chat, leaves config + lastResult untouched). `{ config }` updates code/range/
// capital + name on a run — a changed config drops the now-stale lastResult (the run rewrites it). A
// rename that would collide with another strategy keeps the current name.
const updateBody = z.object({
  config: codeConfigSchema.optional(),
  messages: chatMessagesSchema.optional(),
});

strategiesRoute.post('/:id', validateJson(updateBody), async (c) => {
  const id = c.req.param('id');
  const userId = c.var.userId;
  const { config, messages } = c.req.valid('json');
  if (config) {
    const result = await prisma.$transaction(async (transaction) => {
      const running = await transaction.job.findFirst({
        where: { userId, kind: 'backtest', key: id, status: 'running' },
        select: { id: true },
      });
      if (running) {
        return { kind: 'running' as const };
      }
      const row = await commitStrategyConfig(
        transaction,
        userId,
        id,
        config,
        messages as Prisma.InputJsonValue | undefined,
      );
      return row ? { kind: 'updated' as const, row } : { kind: 'not_found' as const };
    });
    if (result.kind === 'running') {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyBacktestInProgress'));
    }
    return result.kind === 'updated'
      ? c.json(result.row)
      : apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
  }

  const row = await prisma.strategy.findFirst({ where: { id, userId }, select: { id: true } });
  if (!row) {
    return apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
  }
  const updated = await prisma.strategy.update({
    where: { id },
    data: { ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}) },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  return c.json(updated);
});

// DELETE /api/app/strategies/:id — owner-scoped (deleteMany so a foreign id is a no-op → 404).
strategiesRoute.delete('/:id', async (c) => {
  const r = await prisma.strategy.deleteMany({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (r.count === 0) {
    return apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
  }
  return c.json({ ok: true });
});
