import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  factorRuntimeVersion,
  type FactorCompositeDefinition,
  type FactorLanguage,
} from '@jixie/shared';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { BUILTIN_KEYS, BUILTIN_USER_ID, builtinCatalog } from '../factor/builtin-factors.js';
import { validateFactorDefinition } from '../factor/validate-factor-definition.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import { m } from '../i18n/index.js';
import { localeFromRequest } from '../i18n/index.js';
import {
  factorCompositeDefinitionSchema,
  factorPanelCompositeDefinitionV2Schema,
} from '../factor/report-spec.js';
import {
  timeSeriesTemplateCatalog,
  timeSeriesTemplateResource,
} from '../factor/time-series-templates.js';
import { panelTemplateCatalog, panelTemplateResource } from '../factor/panel-templates.js';
import {
  macroRegimeTemplateCatalog,
  macroRegimeTemplateResource,
} from '../factor/macro-regime-templates.js';
import {
  archiveFactor,
  FactorPublicationError,
  publishFactor,
  publishFactorBodySchema,
} from '../factor/publication.js';
import {
  archivePanelComposite,
  publishPanelComposite,
} from '../factor/panel-composite-publication.js';

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

const factorLanguage = (language: string): FactorLanguage =>
  language === 'python' ? 'python' : 'typescript';

/**
 * Factor resources (plural, mounted at /api/app/factors):
 *   GET  /catalog        the factor list (identity + kind) — presets + this user's custom factors
 *   /custom…             custom-factor CRUD + publish/archive/copy (code-first, Agent-authored)
 * Workbench actions (agent / qa / name / analysis / correlation / runs) live in factor.ts (singular).
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const factorsRoute = new Hono();

const visibilityBody = z.object({ visibility: z.enum(['private', 'public']) });

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

factorsRoute.post('/custom/:id/visibility', validateJson(visibilityBody), async (c) => {
  const visibility = c.req.valid('json').visibility;
  const factor = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
    select: { id: true, status: true },
  });
  if (!factor) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  if (visibility === 'public' && factor.status !== 'published') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'assetMustBePublishedBeforeSharing'));
  }
  return c.json(
    await prisma.factor.update({
      where: { id: factor.id },
      data: { visibility },
      select: { id: true, visibility: true },
    }),
  );
});

factorsRoute.post('/composites/:id/publish', validateJson(publishFactorBodySchema), async (c) => {
  try {
    return c.json(
      await publishPanelComposite(
        c.var.userId,
        c.req.param('id'),
        c.req.valid('json').approvedReportId,
      ),
    );
  } catch (error) {
    if (error instanceof FactorPublicationError) {
      return factorPublicationApiError(c, error);
    }
    throw error;
  }
});

factorsRoute.post('/composites/:id/archive', async (c) => {
  const composite = await archivePanelComposite(c.var.userId, c.req.param('id'));
  return composite ? c.json(composite) : apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
});

factorsRoute.post('/composites/:id/visibility', validateJson(visibilityBody), async (c) => {
  const visibility = c.req.valid('json').visibility;
  const composite = await prisma.factorComposite.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
    select: { id: true, status: true },
  });
  if (!composite) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  if (visibility === 'public' && composite.status !== 'published') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'assetMustBePublishedBeforeSharing'));
  }
  return c.json(
    await prisma.factorComposite.update({
      where: { id: composite.id },
      data: { visibility },
      select: { id: true, visibility: true },
    }),
  );
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
      language: true,
      runtimeVersion: true,
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
    language: factorLanguage(factor.language),
    runtimeVersion: factorRuntimeVersion(factorLanguage(factor.language)),
    targetAssetClasses:
      factor.analysisKind === 'time_series' || factor.analysisKind === 'panel'
        ? (['equity', 'fixed_income', 'commodity'] as const)
        : (['equity'] as const),
  }));
  const composites = await prisma.factorComposite.findMany({
    where: { userId: c.var.userId },
    orderBy: { updatedAt: 'desc' },
  });
  const compositeMeta = composites.map((composite) => {
    const definition = factorCompositeDefinitionSchema.parse(composite.definition);
    return {
      key: composite.id,
      label: composite.name,
      kind: 'composite' as const,
      composite: definition,
      factorKey: composite.key ?? undefined,
      strategyKey: strategyKey(composite.key ?? '', composite.status),
      status:
        composite.status === 'published' || composite.status === 'archived'
          ? composite.status
          : ('draft' as const),
      analysisKind: definition.version === 2 ? ('panel' as const) : ('cross_sectional' as const),
      targetAssetClasses:
        definition.version === 2
          ? (['equity', 'fixed_income', 'commodity'] as const)
          : (['equity'] as const),
    };
  });
  return c.json([
    ...builtinCatalog(),
    ...timeSeriesTemplateCatalog(locale),
    ...panelTemplateCatalog(locale),
    ...macroRegimeTemplateCatalog(locale),
    ...customMeta,
    ...compositeMeta,
  ]);
});

const compositeBody = z.object({ definition: factorCompositeDefinitionSchema });

async function validateCompositeComponents(userId: string, definition: FactorCompositeDefinition) {
  const factorIds = definition.components.map((component) => component.factor);
  const owned = await prisma.factor.findMany({
    where: { userId: { in: [userId, BUILTIN_USER_ID] }, id: { in: factorIds } },
    select: { id: true, analysisKind: true },
  });
  const expectedAnalysisKind = definition.version === 2 ? 'panel' : 'cross_sectional';
  const ownedById = new Map(owned.map((factor) => [factor.id, factor]));
  return (
    factorIds.find((id) => {
      const factor = ownedById.get(id);
      return (
        !factor ||
        (expectedAnalysisKind === 'panel'
          ? factor.analysisKind !== 'panel'
          : factor.analysisKind === 'time_series' || factor.analysisKind === 'panel')
      );
    }) ?? null
  );
}

function compositeResource(row: {
  id: string;
  key: string | null;
  name: string;
  definition: Prisma.JsonValue;
  status: string;
  visibility: string;
  approvedReportId: string | null;
  codeHash: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    definition: row.definition as unknown as FactorCompositeDefinition,
    status:
      row.status === 'published' || row.status === 'archived' ? row.status : ('draft' as const),
    visibility: row.visibility === 'public' ? ('public' as const) : ('private' as const),
    approvedReportId: row.approvedReportId,
    codeHash: row.codeHash,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

factorsRoute.get('/composites/:id', async (c) => {
  const row = await prisma.factorComposite.findFirst({
    where: {
      id: c.req.param('id'),
      OR: [{ userId: c.var.userId }, { visibility: 'public', status: 'published' }],
    },
  });
  return row ? c.json(compositeResource(row)) : apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
});

factorsRoute.post('/composites', validateJson(compositeBody), async (c) => {
  const definition = c.req.valid('json').definition;
  const invalid = await validateCompositeComponents(c.var.userId, definition);
  if (invalid) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'unknownFactor', { factor: invalid }));
  }
  if (definition.version === 2) {
    const unavailable =
      BUILTIN_KEYS.has(definition.key) ||
      (await prisma.factor.findFirst({
        where: { key: definition.key, userId: { in: [c.var.userId, BUILTIN_USER_ID] } },
        select: { id: true },
      })) ||
      (await prisma.factorComposite.findFirst({
        where: { key: definition.key, userId: c.var.userId },
        select: { id: true },
      }));
    if (unavailable) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'factorKeyUnavailable'));
    }
  }
  try {
    const row = await prisma.factorComposite.create({
      data: {
        id: ulid(),
        userId: c.var.userId,
        key: definition.version === 2 ? definition.key : null,
        name: definition.name,
        definition: definition as unknown as Prisma.InputJsonValue,
      },
    });
    return c.json(compositeResource(row));
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'factorKeyUnavailable'));
    }
    throw error;
  }
});

factorsRoute.post('/composites/:id', validateJson(compositeBody), async (c) => {
  const definition = c.req.valid('json').definition;
  const invalid = await validateCompositeComponents(c.var.userId, definition);
  if (invalid) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'unknownFactor', { factor: invalid }));
  }
  const existing = await prisma.factorComposite.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
    select: { key: true, status: true },
  });
  if (!existing) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  if (existing.status !== 'draft') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'publishedFactorReadonly'));
  }
  if (definition.version === 2 && existing.key !== definition.key) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'factorKeyUnavailable'));
  }
  const updated = await prisma.factorComposite.updateMany({
    where: { id: c.req.param('id'), userId: c.var.userId, status: 'draft' },
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
  const deleted = await prisma.factorComposite.deleteMany({
    where: { id: c.req.param('id'), userId: c.var.userId, status: 'draft' },
  });
  if (deleted.count === 0) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'publishedFactorReadonly'));
  }
  return c.json({ ok: true });
});

factorsRoute.post('/composites/:id/copy', async (c) => {
  const source = await prisma.factorComposite.findFirst({
    where: {
      id: c.req.param('id'),
      OR: [{ userId: c.var.userId }, { visibility: 'public', status: 'published' }],
    },
  });
  if (!source) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  const definition = factorPanelCompositeDefinitionV2Schema.safeParse(source.definition);
  if (!definition.success || !source.key) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      m(c, 'factorAnalysisKindUnsupported', { kind: 'composite' }),
    );
  }
  if (source.userId !== c.var.userId) {
    const factorIds = definition.data.components.map((component) => component.factor);
    const components = await prisma.factor.findMany({
      where: {
        id: { in: factorIds },
        userId: { in: [source.userId, BUILTIN_USER_ID] },
        status: 'published',
      },
    });
    if (components.length !== factorIds.length) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'factorPublishReportInvalid'));
    }
    const byId = new Map(components.map((component) => [component.id, component]));
    const row = await prisma.$transaction(async (transaction) => {
      const copiedIds = new Map<string, string>();
      for (const factorId of factorIds) {
        const component = byId.get(factorId)!;
        if (component.userId === BUILTIN_USER_ID) {
          copiedIds.set(factorId, factorId);
          continue;
        }
        const { key: componentKey, version: componentVersion } = await nextCopyKey(
          transaction,
          c.var.userId,
          component.key,
        );
        const componentId = ulid();
        await transaction.factor.create({
          data: {
            id: componentId,
            userId: c.var.userId,
            key: componentKey,
            name: `${component.name.replace(/\s+v\d+$/i, '')} v${componentVersion}`.slice(0, 40),
            code: component.code,
            analysisKind: component.analysisKind,
            language: component.language,
            runtimeVersion: component.runtimeVersion,
            descriptionZh: component.descriptionZh,
            descriptionEn: component.descriptionEn,
          },
        });
        copiedIds.set(factorId, componentId);
      }
      const { key, version } = await nextCopyKey(transaction, c.var.userId, source.key!);
      const name = `${source.name.replace(/\s+v\d+$/i, '')} v${version}`.slice(0, 80);
      const copiedDefinition = {
        ...definition.data,
        key,
        name,
        components: definition.data.components.map((component) => ({
          ...component,
          factor: copiedIds.get(component.factor)!,
        })),
      };
      return transaction.factorComposite.create({
        data: {
          id: ulid(),
          userId: c.var.userId,
          key,
          name,
          definition: copiedDefinition as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return c.json(compositeResource(row));
  }

  const { key, version } = await nextCopyKey(prisma, c.var.userId, source.key);
  const nameBase = source.name.replace(/\s+v\d+$/i, '');
  const name = `${nameBase} v${version}`.slice(0, 80);
  const copiedDefinition = { ...definition.data, key, name };
  const row = await prisma.factorComposite.create({
    data: {
      id: ulid(),
      userId: c.var.userId,
      key,
      name,
      definition: copiedDefinition as unknown as Prisma.InputJsonValue,
    },
  });
  return c.json(compositeResource(row));
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
      language: true,
      runtimeVersion: true,
      status: true,
      visibility: true,
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
  const macroRegimeTemplate = macroRegimeTemplateResource(c.req.param('id'), localeFromRequest(c));
  if (macroRegimeTemplate) {
    return c.json(macroRegimeTemplate);
  }
  const row = await prisma.factor.findFirst({
    where: {
      id: c.req.param('id'),
      OR: [
        { userId: { in: [c.var.userId, BUILTIN_USER_ID] } },
        { visibility: 'public', status: 'published' },
      ],
    },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      language: true,
      runtimeVersion: true,
      status: true,
      approvedReportId: true,
      codeHash: true,
      publishedAt: true,
      archivedAt: true,
      descriptionZh: true,
      descriptionEn: true,
      code: true,
      messages: true,
      researchHandoff: true,
      sourceResearchExecution: {
        select: {
          id: true,
          documentId: true,
          title: true,
          displayName: true,
          sequence: true,
          promotedAt: true,
        },
      },
      userId: true,
      visibility: true,
    },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  const { userId: ownerId, ...rest } = row;
  return c.json({
    ...rest,
    messages: ownerId === c.var.userId ? row.messages : null,
    researchHandoff: ownerId === c.var.userId ? row.researchHandoff : null,
    sourceResearchExecution:
      ownerId === c.var.userId && row.sourceResearchExecution
        ? {
            ...row.sourceResearchExecution,
            promotedAt: row.sourceResearchExecution.promotedAt?.toISOString() ?? null,
          }
        : null,
    description: localeFromRequest(c) === 'en' ? row.descriptionEn : row.descriptionZh,
    strategyKey: strategyKey(row.key, row.status),
    builtin: ownerId === BUILTIN_USER_ID,
    owned: ownerId === c.var.userId,
  });
});

// POST /custom — create and persist a draft immediately with its immutable key. The conversation rides
// along as optional `messages`; the initial template is compile-checked before persisting.
const createBody = z.object({
  key: z.string().trim().regex(FACTOR_KEY_PATTERN),
  name: z.string().min(1).max(40),
  code: z.string().min(1),
  analysisKind: z.enum(['cross_sectional', 'time_series', 'panel']).default('cross_sectional'),
  language: z.enum(['typescript', 'python']).default('typescript'),
  messages: chatMessagesSchema.optional(),
});

factorsRoute.post('/custom', validateJson(createBody), async (c) => {
  const userId = c.var.userId;
  const { key, name, code, analysisKind, language, messages } = c.req.valid('json');
  if (
    BUILTIN_KEYS.has(key) ||
    (await prisma.factorComposite.findFirst({
      where: { userId, key },
      select: { id: true },
    }))
  ) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'factorKeyUnavailable'));
  }
  try {
    await validateFactorDefinition(code, analysisKind, language);
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
        language,
        runtimeVersion: factorRuntimeVersion(language),
        code,
        ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}),
      },
    });
    return c.json({
      id,
      key,
      name,
      analysisKind,
      language,
      runtimeVersion: factorRuntimeVersion(language),
      status: 'draft',
    });
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
    select: {
      name: true,
      code: true,
      analysisKind: true,
      language: true,
      status: true,
    },
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

  if (code !== undefined) {
    try {
      await validateFactorDefinition(
        code,
        existing.analysisKind === 'time_series' || existing.analysisKind === 'panel'
          ? existing.analysisKind
          : 'cross_sectional',
        factorLanguage(existing.language),
      );
    } catch (error) {
      return apiError(
        c,
        'VALIDATION_FAILED',
        error instanceof Error ? error.message : m(c, 'factorCodeInvalid'),
      );
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
    where: {
      id: c.req.param('id'),
      OR: [
        { userId: { in: [userId, BUILTIN_USER_ID] } },
        { visibility: 'public', status: 'published' },
      ],
    },
    select: {
      key: true,
      name: true,
      code: true,
      analysisKind: true,
      language: true,
      runtimeVersion: true,
      descriptionZh: true,
      descriptionEn: true,
      messages: true,
      userId: true,
    },
  });
  if (!source) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }

  const { key, version } = await nextCopyKey(prisma, userId, source.key);
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
      language: source.language,
      runtimeVersion: source.runtimeVersion,
      descriptionZh: source.descriptionZh,
      descriptionEn: source.descriptionEn,
      ...(source.userId === userId && source.messages != null ? { messages: source.messages } : {}),
    },
  });
  return c.json({ id, key, name, status: 'draft' });
});

async function nextCopyKey(
  database: Pick<Prisma.TransactionClient, 'factor' | 'factorComposite'>,
  userId: string,
  sourceKey: string,
): Promise<{ key: string; version: number }> {
  const matched = sourceKey.match(/^(.*)_v(\d+)$/);
  const base = matched?.[1] || sourceKey;
  const startingVersion = matched ? Number(matched[2]) + 1 : 2;
  for (let version = startingVersion; version <= startingVersion + 100; version++) {
    const suffix = `_v${version}`;
    const key = `${base.slice(0, 32 - suffix.length).replace(/_+$/g, '')}${suffix}`;
    const [factorTaken, compositeTaken] = await Promise.all([
      database.factor.findFirst({ where: { userId, key }, select: { id: true } }),
      database.factorComposite.findFirst({ where: { userId, key }, select: { id: true } }),
    ]);
    if (!factorTaken && !compositeTaken && !BUILTIN_KEYS.has(key)) {
      return { key, version };
    }
  }
  throw new FactorPublicationError('not_draft');
}
