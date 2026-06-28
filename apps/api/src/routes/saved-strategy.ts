import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import type { BacktestConfig } from '@jixie/shared';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { codeConfigSchema } from '../strategy/code/schema.js';

/**
 * Saved strategies (产品线 1 持久化). Owner-scoped CRUD over the Strategy table. The workbench
 * auto-saves on every backtest run by POSTing the BacktestConfig here; the saved row's name is the
 * config's own name, upserted by (userId, name) so re-running under the same name updates in place
 * instead of spawning duplicates. Every query is scoped by userId, so another user's id 404s.
 */
export const savedStrategyRoute = new Hono();

// GET /api/app/strategies — list the current user's saved strategies (metadata only), newest first.
savedStrategyRoute.get('/', async (c) => {
  const rows = await prisma.strategy.findMany({
    where: { userId: c.var.userId },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  return c.json(rows);
});

// GET /api/app/strategies/:id — full payload (to reopen in the workbench).
savedStrategyRoute.get('/:id', async (c) => {
  const row = await prisma.strategy.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (!row) return apiError(c, 'NOT_FOUND', '策略不存在');
  return c.json({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    config: row.config,
    lastResult: row.lastResult,
  });
});

// POST /api/app/strategies/result — attach a finished run's result to the strategy (by name), shown on
// reopen. Persisted as a single JSON blob (metrics + nav + tradeLog), refreshed each run.
const resultBody = z.object({ name: z.string().min(1).max(100), result: z.unknown() });

savedStrategyRoute.post('/result', validateJson(resultBody), async (c) => {
  const { name, result } = c.req.valid('json');
  await prisma.strategy.updateMany({
    where: { userId: c.var.userId, name },
    data: { lastResult: result as Prisma.InputJsonValue },
  });
  return c.json({ ok: true });
});

// POST /api/app/strategies — auto-save: upsert by (userId, config.name).
savedStrategyRoute.post('/', validateJson(codeConfigSchema), async (c) => {
  const config = c.req.valid('json') as BacktestConfig;
  const userId = c.var.userId;
  const name = config.name;
  const row = await prisma.strategy.upsert({
    where: { userId_name: { userId, name } },
    create: { id: ulid(), userId, name, config: config as unknown as Prisma.InputJsonValue },
    update: { config: config as unknown as Prisma.InputJsonValue },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  return c.json(row);
});

// DELETE /api/app/strategies/:id — owner-scoped (deleteMany so a foreign id is a no-op → 404).
savedStrategyRoute.delete('/:id', async (c) => {
  const r = await prisma.strategy.deleteMany({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (r.count === 0) return apiError(c, 'NOT_FOUND', '策略不存在');
  return c.json({ ok: true });
});
