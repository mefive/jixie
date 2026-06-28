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
  if (!r || !Array.isArray(r.nav) || r.nav.length === 0) return undefined;
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
  // A changed config (new code/range/capital) invalidates any stored last-run result — drop it so a stale
  // equity curve is never shown against new code. On a normal run this clears it, then the finished run
  // re-attaches its result (POST /result); a save-without-run just leaves it cleared until the next run.
  const existing = await prisma.strategy.findUnique({
    where: { userId_name: { userId, name } },
    select: { config: true },
  });
  const configChanged = existing != null && JSON.stringify(existing.config) !== JSON.stringify(config);
  const row = await prisma.strategy.upsert({
    where: { userId_name: { userId, name } },
    create: { id: ulid(), userId, name, config: config as unknown as Prisma.InputJsonValue },
    update: {
      config: config as unknown as Prisma.InputJsonValue,
      ...(configChanged ? { lastResult: PrismaNs.DbNull } : {}),
    },
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
