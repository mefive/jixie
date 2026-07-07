import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import type { ScreenSpec } from '@jixie/shared';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { screenSpecSchema } from '../screen/spec.js';
import { m } from '../i18n/index.js';

/**
 * Saved screens (产品线 2 持久化). Owner-scoped CRUD over the SavedScreen table. Unlike strategies
 * (auto-saved on run), a screen query is saved on demand — the user names a keeper and POSTs it here.
 * Upsert by (userId, name); every query is scoped by userId so a foreign id 404s.
 */
export const savedScreenRoute = new Hono();

const saveBody = z.object({
  name: z.string().trim().min(1).max(100),
  spec: screenSpecSchema,
});

// GET /api/app/screens — list the current user's saved screens (metadata only), newest first.
savedScreenRoute.get('/', async (c) => {
  const rows = await prisma.savedScreen.findMany({
    where: { userId: c.var.userId },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  return c.json(rows);
});

// GET /api/app/screens/:id — full payload (to reopen in the screener).
savedScreenRoute.get('/:id', async (c) => {
  const row = await prisma.savedScreen.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', m(c, 'screenNotFound'));
  }
  return c.json({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    spec: row.spec,
  });
});

// POST /api/app/screens — manual save: upsert by (userId, name).
savedScreenRoute.post('/', validateJson(saveBody), async (c) => {
  const { name, spec } = c.req.valid('json') as { name: string; spec: ScreenSpec };
  const userId = c.var.userId;
  const row = await prisma.savedScreen.upsert({
    where: { userId_name: { userId, name } },
    create: { id: ulid(), userId, name, spec: spec as unknown as Prisma.InputJsonValue },
    update: { spec: spec as unknown as Prisma.InputJsonValue },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  return c.json(row);
});

// DELETE /api/app/screens/:id — owner-scoped (deleteMany so a foreign id is a no-op → 404).
savedScreenRoute.delete('/:id', async (c) => {
  const r = await prisma.savedScreen.deleteMany({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (r.count === 0) {
    return apiError(c, 'NOT_FOUND', m(c, 'screenNotFound'));
  }
  return c.json({ ok: true });
});
