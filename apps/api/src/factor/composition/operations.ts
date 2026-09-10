import { ulid } from 'ulid';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { type FactorCompositeDefinition } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { BUILTIN_KEYS, BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
import {
  factorCompositeDefinitionSchema,
  factorPanelCompositeDefinitionV2Schema,
} from '../reports/spec.js';
import { nextCopyKey } from '../definitions/copy-key.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from '../operation-errors.js';

export const factorCompositeInputSchema = z.object({ definition: factorCompositeDefinitionSchema });

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

export async function readFactorComposite(userId: string, compositeId: string, locale: Locale) {
  const row = await prisma.factorComposite.findFirst({
    where: {
      id: compositeId,
      OR: [{ userId }, { visibility: 'public', status: 'published' }],
    },
  });

  return row ? compositeResource(row) : failFactorOperation('missing', t(locale, 'factorNotFound'));
}

export async function createFactorComposite(
  userId: string,
  input: z.infer<typeof factorCompositeInputSchema>,
  locale: Locale,
) {
  const definition = input.definition;
  const invalid = await validateCompositeComponents(userId, definition);

  if (invalid) {
    return failFactorOperation('invalid', t(locale, 'unknownFactor', { factor: invalid }));
  }

  if (definition.version === 2) {
    const unavailable =
      BUILTIN_KEYS.has(definition.key) ||
      (await prisma.factor.findFirst({
        where: { key: definition.key, userId: { in: [userId, BUILTIN_USER_ID] } },
        select: { id: true },
      })) ||
      (await prisma.factorComposite.findFirst({
        where: { key: definition.key, userId },
        select: { id: true },
      }));
    if (unavailable) {
      return failFactorOperation('invalid', t(locale, 'factorKeyUnavailable'));
    }
  }

  try {
    const row = await prisma.factorComposite.create({
      data: {
        id: ulid(),
        userId,
        key: definition.version === 2 ? definition.key : null,
        name: definition.name,
        definition: definition as unknown as Prisma.InputJsonValue,
      },
    });
    return compositeResource(row);
  } catch (error) {
    if (
      (
        error as {
          code?: string;
        }
      ).code === 'P2002'
    ) {
      return failFactorOperation('invalid', t(locale, 'factorKeyUnavailable'));
    }
    throw error;
  }
}

export async function updateFactorComposite(
  userId: string,
  compositeId: string,
  input: z.infer<typeof factorCompositeInputSchema>,
  locale: Locale,
) {
  const definition = input.definition;
  const invalid = await validateCompositeComponents(userId, definition);

  if (invalid) {
    return failFactorOperation('invalid', t(locale, 'unknownFactor', { factor: invalid }));
  }

  const existing = await prisma.factorComposite.findFirst({
    where: { id: compositeId, userId },
    select: { key: true, status: true },
  });

  if (!existing) {
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  if (existing.status !== 'draft') {
    return failFactorOperation('invalid', t(locale, 'publishedFactorReadonly'));
  }

  if (definition.version === 2 && existing.key !== definition.key) {
    return failFactorOperation('invalid', t(locale, 'factorKeyUnavailable'));
  }

  const updated = await prisma.factorComposite.updateMany({
    where: { id: compositeId, userId, status: 'draft' },
    data: {
      name: definition.name,
      definition: definition as unknown as Prisma.InputJsonValue,
    },
  });

  if (updated.count === 0) {
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  const row = await prisma.factorComposite.findUniqueOrThrow({
    where: { id: compositeId },
  });

  return compositeResource(row);
}

export async function deleteFactorComposite(userId: string, compositeId: string, locale: Locale) {
  const deleted = await prisma.factorComposite.deleteMany({
    where: { id: compositeId, userId, status: 'draft' },
  });

  if (deleted.count === 0) {
    return failFactorOperation('invalid', t(locale, 'publishedFactorReadonly'));
  }

  return { ok: true };
}

export async function copyFactorComposite(userId: string, compositeId: string, locale: Locale) {
  const source = await prisma.factorComposite.findFirst({
    where: {
      id: compositeId,
      OR: [{ userId }, { visibility: 'public', status: 'published' }],
    },
  });

  if (!source) {
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  const definition = factorPanelCompositeDefinitionV2Schema.safeParse(source.definition);

  if (!definition.success || !source.key) {
    return failFactorOperation(
      'invalid',
      t(locale, 'factorAnalysisKindUnsupported', { kind: 'composite' }),
    );
  }

  if (source.userId !== userId) {
    const factorIds = definition.data.components.map((component) => component.factor);
    const components = await prisma.factor.findMany({
      where: {
        id: { in: factorIds },
        userId: { in: [source.userId, BUILTIN_USER_ID] },
        status: 'published',
      },
    });
    if (components.length !== factorIds.length) {
      return failFactorOperation('invalid', t(locale, 'factorPublishReportInvalid'));
    }
    const byId = new Map(components.map((component) => [component.id, component]));
    // A foreign public composite becomes an owned draft with independent component copies.
    // Keep all copies in one transaction so a failed composite insert leaves no orphan drafts.
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
          userId,
          component.key,
        );
        const componentId = ulid();
        await transaction.factor.create({
          data: {
            id: componentId,
            userId,
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
      const { key, version } = await nextCopyKey(transaction, userId, source.key!);
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
          userId,
          key,
          name,
          definition: copiedDefinition as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return compositeResource(row);
  }

  const { key, version } = await nextCopyKey(prisma, userId, source.key);
  const nameBase = source.name.replace(/\s+v\d+$/i, '');
  const name = `${nameBase} v${version}`.slice(0, 80);
  const copiedDefinition = { ...definition.data, key, name };
  const row = await prisma.factorComposite.create({
    data: {
      id: ulid(),
      userId,
      key,
      name,
      definition: copiedDefinition as unknown as Prisma.InputJsonValue,
    },
  });

  return compositeResource(row);
}
