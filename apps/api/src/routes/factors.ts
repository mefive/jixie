import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { FactorCompositeDefinitionV1 } from '@jixie/shared';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { BUILTIN_KEYS, BUILTIN_USER_ID, builtinCatalog } from '../factor/builtin-factors.js';
import { validateFactorDefinition } from '../factor/validate-factor-definition.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import { m } from '../i18n/index.js';
import { localeFromRequest } from '../i18n/index.js';
import { factorCompositeDefinitionV1Schema } from '../factor/report-spec.js';
import {
  timeSeriesTemplateCatalog,
  timeSeriesTemplateResource,
} from '../factor/time-series-templates.js';
import { panelTemplateCatalog, panelTemplateResource } from '../factor/panel-templates.js';
import {
  archiveFactor,
  FactorPublicationError,
  publishFactor,
  publishFactorBodySchema,
} from '../factor/publication.js';

const FACTOR_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function factorPublicationApiError(
  c: Parameters<typeof apiError>[0],
  error: FactorPublicationError,
) {
  const messageKey = {
    not_found: 'factorNotFound',
    not_draft: 'publishedFactorReadonly',
    report_invalid: 'factorPublishReportInvalid',
    report_outdated: 'factorPublishReportOutdated',
  }[error.reason] as Parameters<typeof m>[1];
  return apiError(
    c,
    error.reason === 'not_found' ? 'NOT_FOUND' : 'VALIDATION_FAILED',
    m(c, messageKey),
  );
}

const strategyKey = (key: string, status: string): string | undefined =>
  status === 'published' ? key : undefined;

/**
 * Factor resources (plural, mounted at /api/app/factors):
 *   GET  /catalog        the factor list (identity + kind) — presets + this user's custom factors
 *   /custom…             custom-factor CRUD + publish/archive/copy (code-first, Agent-authored)
 * Workbench actions (agent / qa / name / analysis / correlation / runs) live in factor.ts (singular).
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const factorsRoute = new Hono();

factorsRoute.post('/custom/:id/publish', validateJson(publishFactorBodySchema), async (c) => {
  try {
    return c.json(
      await publishFactor(c.var.userId, c.req.param('id'), c.req.valid('json').approvedReportId),
    );
  } catch (error) {
    if (error instanceof FactorPublicationError) {
      return factorPublicationApiError(c, error);
    }
    throw error;
  }
});

factorsRoute.post('/custom/:id/archive', async (c) => {
  const factor = await archiveFactor(c.var.userId, c.req.param('id'));
  return factor ? c.json(factor) : apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
});

factorsRoute.get('/catalog', async (c) => {
  // Preset factors (registry identity; code lives on their seeded rows) + this user's custom factors.
  const custom = await prisma.factor.findMany({
    where: { userId: c.var.userId },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      status: true,
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
    strategyKey: strategyKey(factor.key, factor.status),
    status:
      factor.status === 'published' || factor.status === 'archived'
        ? factor.status
        : ('draft' as const),
    kind: 'custom' as const,
    analysisKind:
      factor.analysisKind === 'time_series'
        ? ('time_series' as const)
        : factor.analysisKind === 'panel'
          ? ('panel' as const)
          : ('cross_sectional' as const),
    targetAssetClasses:
      factor.analysisKind === 'time_series' || factor.analysisKind === 'panel'
        ? (['equity', 'fixed_income', 'commodity'] as const)
        : (['equity'] as const),
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
  return c.json([
    ...builtinCatalog(),
    ...timeSeriesTemplateCatalog(locale),
    ...panelTemplateCatalog(locale),
    ...customMeta,
    ...compositeMeta,
  ]);
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

factorsRoute.get('/custom', async (c) => {
  const rows = await prisma.factor.findMany({
    where: { userId: c.var.userId },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  return c.json(rows);
});

factorsRoute.get('/custom/:id', async (c) => {
  // Own factors are editable; builtin (preset) rows are readable by anyone — the UI shows their
  // code read-only with a "copy as custom" affordance.
  const timeSeriesTemplate = timeSeriesTemplateResource(c.req.param('id'), localeFromRequest(c));
  if (timeSeriesTemplate) {
    return c.json(timeSeriesTemplate);
  }
  const panelTemplate = panelTemplateResource(c.req.param('id'), localeFromRequest(c));
  if (panelTemplate) {
    return c.json(panelTemplate);
  }
  const row = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: { in: [c.var.userId, BUILTIN_USER_ID] } },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      status: true,
      approvedReportId: true,
      codeHash: true,
      publishedAt: true,
      archivedAt: true,
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
    strategyKey: strategyKey(row.key, row.status),
    builtin: ownerId === BUILTIN_USER_ID,
  });
});

// POST /custom — create and persist a draft immediately with its immutable key. The conversation rides
// along as optional `messages`; the initial template is compile-checked before persisting.
const createBody = z.object({
  key: z.string().trim().regex(FACTOR_KEY_PATTERN),
  name: z.string().min(1).max(40),
  code: z.string().min(1),
  analysisKind: z.enum(['cross_sectional', 'time_series', 'panel']).default('cross_sectional'),
  messages: chatMessagesSchema.optional(),
});

factorsRoute.post('/custom', validateJson(createBody), async (c) => {
  const userId = c.var.userId;
  const { key, name, code, analysisKind, messages } = c.req.valid('json');
  if (BUILTIN_KEYS.has(key)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'factorKeyUnavailable'));
  }
  try {
    await validateFactorDefinition(code, analysisKind);
  } catch (e) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      e instanceof Error ? e.message : m(c, 'factorCodeInvalid'),
    );
  }
  const id = ulid();
  try {
    await prisma.factor.create({
      data: {
        id,
        userId,
        key,
        name,
        analysisKind,
        code,
        ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}),
      },
    });
    return c.json({ id, key, name, status: 'draft' });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'factorKeyUnavailable'));
    }
    throw error;
  }
});

// POST /custom/:id — autosave a draft by id. Historical reports keep their frozen code snapshots.
// Published and archived Factors are immutable; either code/name/messages may be present for drafts.
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
    select: { name: true, code: true, analysisKind: true, status: true },
  });
  if (!existing) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  if (existing.status !== 'draft') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'publishedFactorReadonly'));
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

factorsRoute.delete('/custom/:id', async (c) => {
  const userId = c.var.userId;
  const id = c.req.param('id');
  if (BUILTIN_KEYS.has(id)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'presetFactorReadonlyDelete'));
  }
  const factor = await prisma.factor.findFirst({ where: { id, userId }, select: { status: true } });
  if (!factor) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  if (factor.status !== 'draft') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'publishedFactorCannotDelete'));
  }
  const pinned = await prisma.factorWeatherPin.count({ where: { factorId: id } });
  if (pinned > 0) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'pinnedFactorReadonlyDelete'));
  }
  await prisma.factor.deleteMany({ where: { id, userId } });
  return c.json({ ok: true });
});

// POST /custom/:id/copy — take one independent snapshot into a new editable draft.
factorsRoute.post('/custom/:id/copy', async (c) => {
  const userId = c.var.userId;
  const source = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: { in: [userId, BUILTIN_USER_ID] } },
    select: {
      key: true,
      name: true,
      code: true,
      analysisKind: true,
      descriptionZh: true,
      descriptionEn: true,
      messages: true,
    },
  });
  if (!source) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }

  const { key, version } = await nextCopyKey(userId, source.key);
  const nameBase = source.name.replace(/\s+v\d+$/i, '');
  const name = `${nameBase} v${version}`.slice(0, 40);
  const id = ulid();
  await prisma.factor.create({
    data: {
      id,
      userId,
      key,
      name,
      code: source.code,
      analysisKind: source.analysisKind,
      descriptionZh: source.descriptionZh,
      descriptionEn: source.descriptionEn,
      messages: source.messages ?? undefined,
    },
  });
  return c.json({ id, key, name, status: 'draft' });
});

async function nextCopyKey(
  userId: string,
  sourceKey: string,
): Promise<{ key: string; version: number }> {
  const matched = sourceKey.match(/^(.*)_v(\d+)$/);
  const base = matched?.[1] || sourceKey;
  const startingVersion = matched ? Number(matched[2]) + 1 : 2;
  for (let version = startingVersion; version <= startingVersion + 100; version++) {
    const suffix = `_v${version}`;
    const key = `${base.slice(0, 32 - suffix.length).replace(/_+$/g, '')}${suffix}`;
    const taken = await prisma.factor.findFirst({ where: { userId, key }, select: { id: true } });
    if (!taken && !BUILTIN_KEYS.has(key)) {
      return { key, version };
    }
  }
  throw new FactorPublicationError('not_draft');
}
