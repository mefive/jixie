import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import pkg from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { BacktestConfig, BacktestSummary, StrategyCard } from '@jixie/shared';

const { Prisma: PrismaNs } = pkg; // runtime namespace (DbNull) — the type import above is erased
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

// GET /api/app/strategies — list the user's saved strategies + a compact last-run snapshot (sparkline +
// metrics) per card, newest first.
savedStrategyRoute.get('/', async (c) => {
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
savedStrategyRoute.get('/:id', async (c) => {
  const row = await prisma.strategy.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', '策略不存在');
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

const chatMessagesSchema = z
  .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
  .max(60);

/** The run-relevant part of a config (excludes name) — changing any of these invalidates a stored run. */
function runKey(config: unknown): string {
  const c = config as Partial<BacktestConfig> | null;
  return JSON.stringify({
    start: c?.start,
    end: c?.end,
    initialCash: c?.initialCash,
    code: c?.code,
  });
}

// Make an LLM-suggested name unique within the user (append " N") so a fresh strategy never overwrites
// an existing one — names aren't a natural key here (updates go by id), only unique for tidiness.
async function uniqueName(userId: string, base: string): Promise<string> {
  for (let suffix = 1; suffix <= 50; suffix++) {
    const name = suffix === 1 ? base : `${base} ${suffix}`;
    const taken = await prisma.strategy.findUnique({
      where: { userId_name: { userId, name } },
      select: { id: true },
    });
    if (!taken) {
      return name;
    }
  }
  return `${base} ${ulid().slice(-4)}`;
}

// POST /api/app/strategies — create a NEW strategy row (created up front on the first Agent prompt, so
// the conversation has something to attach to). The Agent conversation rides along as an optional
// `messages` array. Config (code/range/capital) + name are the initial values; later they change only
// on a run (POST /:id), while messages save in real time.
const createBody = codeConfigSchema.extend({ messages: chatMessagesSchema.optional() });

savedStrategyRoute.post('/', validateJson(createBody), async (c) => {
  const { messages, ...cfg } = c.req.valid('json') as BacktestConfig & { messages?: unknown[] };
  const userId = c.var.userId;
  const name = await uniqueName(userId, cfg.name);
  const config = { ...cfg, name };
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

savedStrategyRoute.post('/:id', validateJson(updateBody), async (c) => {
  const id = c.req.param('id');
  const userId = c.var.userId;
  const { config, messages } = c.req.valid('json');
  const existing = await prisma.strategy.findFirst({
    where: { id, userId },
    select: { config: true, name: true },
  });
  if (!existing) {
    return apiError(c, 'NOT_FOUND', '策略不存在');
  }

  const data: Prisma.StrategyUpdateInput = {};
  if (messages !== undefined) {
    data.messages = messages as Prisma.InputJsonValue;
  }
  if (config) {
    let name = config.name;
    if (name !== existing.name) {
      const taken = await prisma.strategy.findUnique({
        where: { userId_name: { userId, name } },
        select: { id: true },
      });
      if (taken && taken.id !== id) {
        name = existing.name; // rename collides — keep the current name
      }
    }
    const nextConfig = { ...config, name };
    data.name = name;
    data.config = nextConfig as unknown as Prisma.InputJsonValue;
    // Only a change to the RUN-relevant fields (range/capital/code — not name) invalidates the result;
    // a rename must not drop the fresh result (the post-run name refresh persists a name-only change).
    if (runKey(existing.config) !== runKey(nextConfig)) {
      data.lastResult = PrismaNs.DbNull; // stale for the new code; the run rewrites it
    }
  }

  const row = await prisma.strategy.update({
    where: { id },
    data,
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  return c.json(row);
});

// DELETE /api/app/strategies/:id — owner-scoped (deleteMany so a foreign id is a no-op → 404).
savedStrategyRoute.delete('/:id', async (c) => {
  const r = await prisma.strategy.deleteMany({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (r.count === 0) {
    return apiError(c, 'NOT_FOUND', '策略不存在');
  }
  return c.json({ ok: true });
});
