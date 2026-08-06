import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { FactorCompositeDefinitionV1 } from '@jixie/shared';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { BUILTIN_KEYS, BUILTIN_USER_ID, builtinCatalog } from '../factor/builtin-factors.js';
import { compileFactor } from '../factor/compile-factor.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import { m } from '../i18n/index.js';
import { localeFromRequest } from '../i18n/index.js';
import { factorCompositeDefinitionV1Schema } from '../factor/report-spec.js';
import {
  FactorReleaseError,
  getFactorRelease,
  listFactorReleases,
  publishFactorRelease,
  publishFactorReleaseBodySchema,
  retireFactorRelease,
} from '../factor/releases.js';

const FACTOR_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function factorReleaseApiError(c: Parameters<typeof apiError>[0], error: FactorReleaseError) {
  const messageKey = {
    source_not_found: 'factorNotFound',
    key_required: 'factorReleaseKeyRequired',
    key_unavailable: 'factorReleaseKeyUnavailable',
    report_invalid: 'factorReleaseReportInvalid',
    validation_required: 'factorReleaseValidationRequired',
    production_not_ready: 'factorReleaseProductionNotReady',
    input_dependencies_unknown: 'factorReleaseInputDependenciesUnknown',
    metadata_mismatch: 'factorReleaseMetadataMismatch',
  }[error.reason] as Parameters<typeof m>[1];
  return apiError(
    c,
    error.reason === 'source_not_found' ? 'NOT_FOUND' : 'VALIDATION_FAILED',
    m(c, messageKey),
  );
}

const strategyKey = (key: string | null): string | undefined => (key ? `custom:${key}` : undefined);

/**
 * Factor resources (plural, mounted at /api/app/factors):
 *   GET  /catalog        the factor list (identity + kind) — presets + this user's custom factors
 *   /custom…             custom-factor CRUD + fork (code-first, Agent-authored)
 * Workbench actions (agent / qa / name / analysis / correlation / runs) live in factor.ts (singular).
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const factorsRoute = new Hono();

factorsRoute.get('/releases', async (c) => c.json(await listFactorReleases(c.var.userId)));

factorsRoute.get('/releases/:id', async (c) => {
  const release = await getFactorRelease(c.var.userId, c.req.param('id'));
  return release ? c.json(release) : apiError(c, 'NOT_FOUND', m(c, 'factorReleaseNotFound'));
});

factorsRoute.post('/releases', validateJson(publishFactorReleaseBodySchema), async (c) => {
  try {
    return c.json(await publishFactorRelease(c.var.userId, c.req.valid('json')));
  } catch (error) {
    if (error instanceof FactorReleaseError) {
      return factorReleaseApiError(c, error);
    }
    throw error;
  }
});

factorsRoute.post('/releases/:id/retire', async (c) => {
  const release = await retireFactorRelease(c.var.userId, c.req.param('id'));
  return release ? c.json(release) : apiError(c, 'NOT_FOUND', m(c, 'factorReleaseNotFound'));
});

factorsRoute.get('/catalog', async (c) => {
  // Preset factors (registry identity; code lives on their seeded rows) + this user's custom factors.
  const custom = await prisma.factor.findMany({
    where: { userId: c.var.userId },
    select: {
      id: true,
      key: true,
      keyCandidate: true,
      name: true,
      descriptionZh: true,
      descriptionEn: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  const locale = localeFromRequest(c);
  const customMeta = custom.map((factor) => ({
    key: factor.id,
    label: factor.name,
    description: locale === 'en' ? factor.descriptionEn : factor.descriptionZh,
    strategyKey: strategyKey(factor.key),
    keyCandidate: factor.keyCandidate ?? undefined,
    kind: 'custom' as const,
  }));
  const composites = await prisma.factorComposite.findMany({
    where: { userId: c.var.userId },
    orderBy: { updatedAt: 'desc' },
  });
  const compositeMeta = composites.map((composite) => ({
    key: composite.id,
    label: composite.name,
    kind: 'composite' as const,
    composite: composite.definition as unknown as FactorCompositeDefinitionV1,
  }));
  return c.json([...builtinCatalog(), ...customMeta, ...compositeMeta]);
});

const compositeBody = z.object({ definition: factorCompositeDefinitionV1Schema });

async function validateCompositeComponents(
  userId: string,
  definition: FactorCompositeDefinitionV1,
) {
  const customIds = definition.components
    .map((component) => component.factor)
    .filter((factor) => !BUILTIN_KEYS.has(factor));
  if (customIds.length === 0) {
    return null;
  }
  const owned = await prisma.factor.findMany({
    where: { userId, id: { in: customIds } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((factor) => factor.id));
  return customIds.find((id) => !ownedIds.has(id)) ?? null;
}

function compositeResource(row: {
  id: string;
  name: string;
  definition: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    definition: row.definition as unknown as FactorCompositeDefinitionV1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

factorsRoute.get('/composites/:id', async (c) => {
  const row = await prisma.factorComposite.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  return row ? c.json(compositeResource(row)) : apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
});

factorsRoute.post('/composites', validateJson(compositeBody), async (c) => {
  const definition = c.req.valid('json').definition;
  const invalid = await validateCompositeComponents(c.var.userId, definition);
  if (invalid) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'unknownFactor', { factor: invalid }));
  }
  const row = await prisma.factorComposite.create({
    data: {
      id: ulid(),
      userId: c.var.userId,
      name: definition.name,
      definition: definition as unknown as Prisma.InputJsonValue,
    },
  });
  return c.json(compositeResource(row));
});

factorsRoute.post('/composites/:id', validateJson(compositeBody), async (c) => {
  const definition = c.req.valid('json').definition;
  const invalid = await validateCompositeComponents(c.var.userId, definition);
  if (invalid) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'unknownFactor', { factor: invalid }));
  }
  const updated = await prisma.factorComposite.updateMany({
    where: { id: c.req.param('id'), userId: c.var.userId },
    data: {
      name: definition.name,
      definition: definition as unknown as Prisma.InputJsonValue,
    },
  });
  if (updated.count === 0) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  const row = await prisma.factorComposite.findUniqueOrThrow({
    where: { id: c.req.param('id') },
  });
  return c.json(compositeResource(row));
});

factorsRoute.delete('/composites/:id', async (c) => {
  await prisma.factorComposite.deleteMany({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  return c.json({ ok: true });
});

// —— Custom factors (code-first, Agent-authored — mirrors the strategy workbench) —— created on the
// first Agent prompt, then updated by id: messages in real time, code/name on an analysis run.

/** Give copied factors a distinct display name; display names are not program identities. */
async function uniqueFactorName(userId: string, base: string): Promise<string> {
  for (let suffix = 1; suffix <= 50; suffix++) {
    const name = suffix === 1 ? base : `${base} ${suffix}`;
    const taken = await prisma.factor.findFirst({
      where: { userId, name },
      select: { id: true },
    });
    if (!taken) {
      return name;
    }
  }
  return `${base} ${ulid().slice(-4)}`;
}

factorsRoute.get('/custom', async (c) => {
  const rows = await prisma.factor.findMany({
    where: { userId: c.var.userId },
    select: { id: true, key: true, keyCandidate: true, name: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  return c.json(rows);
});

factorsRoute.get('/custom/:id', async (c) => {
  // Own factors are editable; builtin (preset) rows are readable by anyone — the UI shows their
  // code read-only with a "copy as custom" affordance.
  const row = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: { in: [c.var.userId, BUILTIN_USER_ID] } },
    select: {
      id: true,
      key: true,
      keyCandidate: true,
      name: true,
      descriptionZh: true,
      descriptionEn: true,
      code: true,
      messages: true,
      userId: true,
    },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  const { userId: ownerId, ...rest } = row;
  return c.json({
    ...rest,
    description: localeFromRequest(c) === 'en' ? row.descriptionEn : row.descriptionZh,
    strategyKey: strategyKey(row.key),
    builtin: ownerId === BUILTIN_USER_ID,
  });
});

// POST /custom — create a NEW factor row (up front on the first Agent prompt). The conversation rides
// along as optional `messages`; the code is compile-checked before persisting.
const createBody = z.object({
  name: z.string().min(1).max(40),
  code: z.string().min(1),
  messages: chatMessagesSchema.optional(),
});

factorsRoute.post('/custom', validateJson(createBody), async (c) => {
  const userId = c.var.userId;
  const { name, code, messages } = c.req.valid('json');
  try {
    (await compileFactor(code)).dispose(); // validate-only
  } catch (e) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      e instanceof Error ? e.message : m(c, 'factorCodeInvalid'),
    );
  }
  const uniqueName = await uniqueFactorName(userId, name);
  const id = ulid();
  await prisma.factor.create({
    data: {
      id,
      userId,
      name: uniqueName,
      code,
      ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}),
    },
  });
  return c.json({ id, name: uniqueName });
});

// POST /custom/:id — update by id. `{ messages }` alone = real-time chat save (code/name untouched);
// `{ code, name }` = an analysis run's commit (compile-check and rename unless it collides). Historical
// reports keep their frozen code snapshots. Either may be present.
const updateBody = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).max(40).optional(),
  messages: chatMessagesSchema.optional(),
});

factorsRoute.post('/custom/:id', validateJson(updateBody), async (c) => {
  const id = c.req.param('id');
  const userId = c.var.userId;
  const { code, name, messages } = c.req.valid('json');
  if (BUILTIN_KEYS.has(id)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'presetFactorReadonlyEdit'));
  }
  const existing = await prisma.factor.findFirst({
    where: { id, userId },
    select: { name: true, code: true },
  });
  if (!existing) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  if (code !== undefined && code !== existing.code) {
    const pinned = await prisma.factorWeatherPin.count({ where: { factorId: id } });
    if (pinned > 0) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'pinnedFactorReadonlyEdit'));
    }
  }

  const data: Prisma.FactorUpdateInput = {};
  if (messages !== undefined) {
    data.messages = messages as Prisma.InputJsonValue;
  }
  if (code !== undefined) {
    try {
      (await compileFactor(code)).dispose(); // validate-only
    } catch (e) {
      return apiError(
        c,
        'VALIDATION_FAILED',
        e instanceof Error ? e.message : m(c, 'factorCodeInvalid'),
      );
    }
    data.code = code;
  }
  if (name !== undefined && name !== existing.name) {
    data.name = name;
  }

  const row = await prisma.factor.update({
    where: { id },
    data,
    select: { id: true, name: true },
  });
  return c.json(row);
});

const finalizeKeyBody = z.object({ key: z.string().trim().min(1).max(32) });

/** Allocate an immutable strategy key. LLM/user proposals are advisory; this loop owns uniqueness. */
factorsRoute.post('/custom/:id/finalize-key', validateJson(finalizeKeyBody), async (c) => {
  const id = c.req.param('id');
  const userId = c.var.userId;
  const requested = c.req.valid('json').key;
  if (!FACTOR_KEY_PATTERN.test(requested)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'factorKeyInvalid'));
  }

  const factor = await prisma.factor.findFirst({
    where: { id, userId },
    select: { key: true },
  });
  if (!factor) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  if (factor.key) {
    return c.json({ id, key: factor.key, strategyKey: strategyKey(factor.key) });
  }

  for (let suffix = 1; suffix <= 100; suffix++) {
    const suffixText = suffix === 1 ? '' : `_${suffix}`;
    const candidate = `${requested.slice(0, 32 - suffixText.length).replace(/_+$/g, '')}${suffixText}`;
    if (BUILTIN_KEYS.has(candidate)) {
      continue;
    }
    const published = await prisma.factorRelease.count({
      where: { userId, releaseKey: candidate },
    });
    if (published > 0) {
      continue;
    }
    try {
      const updated = await prisma.factor.updateMany({
        where: { id, userId, key: null },
        data: { key: candidate, keyCandidate: candidate },
      });
      if (updated.count === 1) {
        return c.json({ id, key: candidate, strategyKey: strategyKey(candidate) });
      }
      const current = await prisma.factor.findFirst({
        where: { id, userId },
        select: { key: true },
      });
      if (current?.key) {
        return c.json({ id, key: current.key, strategyKey: strategyKey(current.key) });
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') {
        throw error;
      }
    }
  }
  return apiError(c, 'VALIDATION_FAILED', m(c, 'factorKeyUnavailable'));
});

factorsRoute.delete('/custom/:id', async (c) => {
  const userId = c.var.userId;
  const id = c.req.param('id');
  if (BUILTIN_KEYS.has(id)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'presetFactorReadonlyDelete'));
  }
  const pinned = await prisma.factorWeatherPin.count({ where: { factorId: id } });
  if (pinned > 0) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'pinnedFactorReadonlyDelete'));
  }
  await prisma.factor.deleteMany({ where: { id, userId } });
  return c.json({ ok: true });
});

// POST /custom/:id/fork — copy a factor's code (a builtin preset or one of your own) into a NEW
// editable custom factor — the "tweak params to spawn a variant" research path (factor-to-strategy.md path 2).
factorsRoute.post('/custom/:id/fork', async (c) => {
  const userId = c.var.userId;
  const source = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: { in: [userId, BUILTIN_USER_ID] } },
    select: { name: true, code: true },
  });
  if (!source) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }

  const name = await uniqueFactorName(userId, `${source.name} ${m(c, 'copySuffix')}`.slice(0, 40));
  const id = ulid();
  await prisma.factor.create({ data: { id, userId, name, code: source.code } });
  return c.json({ id, name });
});
