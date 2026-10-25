import { getDatabase } from '#infra/database/prisma.js';
import type { FactorCompositeDefinition } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { BUILTIN_KEYS, BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
import { nextCopyKey } from '../definitions/copy-key.js';
import { FactorError } from '../errors.js';
import {
  factorPanelCompositeDefinitionV2Schema,
  type FactorCompositeInput,
} from '@jixie/shared/api/factor';

async function validateCompositeComponents(userId: string, definition: FactorCompositeDefinition) {
  const factorIds = definition.components.map((component) => component.factor);
  const owned = await getDatabase().factor.findMany({
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

/**
 * 整理当前用户的组合因子及其组件配置。
 *
 * Render an owned composite factor and its component configuration.
 */
function compositeResource(row: {
  id: string;
  key: string | null;
  name: string;
  definition: Prisma.JsonValue;
  status: string;
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
    approvedReportId: row.approvedReportId,
    codeHash: row.codeHash,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function readFactorComposite(userId: string, compositeId: string) {
  const row = await getDatabase().factorComposite.findFirst({
    where: {
      id: compositeId,
      userId,
    },
  });

  if (row) {
    return compositeResource(row);
  }
  throw new FactorError('factor_not_found');
}

/**
 * 验证组件可访问性和协议兼容性后创建组合因子。
 *
 * Validate component access and protocol compatibility before creating a composite factor.
 */
export async function createFactorComposite(userId: string, input: FactorCompositeInput) {
  const definition = input.definition;
  const invalid = await validateCompositeComponents(userId, definition);

  if (invalid) {
    throw new FactorError('unknown_factor', { params: { factor: invalid } });
  }

  if (definition.version === 2) {
    const unavailable =
      BUILTIN_KEYS.has(definition.key) ||
      (await getDatabase().factor.findFirst({
        where: { key: definition.key, userId: { in: [userId, BUILTIN_USER_ID] } },
        select: { id: true },
      })) ||
      (await getDatabase().factorComposite.findFirst({
        where: { key: definition.key, userId },
        select: { id: true },
      }));
    if (unavailable) {
      throw new FactorError('factor_key_unavailable');
    }
  }

  try {
    const row = await getDatabase().factorComposite.create({
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
      throw new FactorError('factor_key_unavailable');
    }
    throw error;
  }
}

/**
 * 按归属更新组合定义并处理旧配置结果的失效。
 *
 * Update an owned composite definition and invalidate results tied to older inputs.
 */
export async function updateFactorComposite(
  userId: string,
  compositeId: string,
  input: FactorCompositeInput,
) {
  const definition = input.definition;
  const invalid = await validateCompositeComponents(userId, definition);

  if (invalid) {
    throw new FactorError('unknown_factor', { params: { factor: invalid } });
  }

  const existing = await getDatabase().factorComposite.findFirst({
    where: { id: compositeId, userId },
    select: { key: true, status: true },
  });

  if (!existing) {
    throw new FactorError('factor_not_found');
  }

  if (existing.status !== 'draft') {
    throw new FactorError('published_factor_readonly');
  }

  if (definition.version === 2 && existing.key !== definition.key) {
    throw new FactorError('factor_key_unavailable');
  }

  const updated = await getDatabase().factorComposite.updateMany({
    where: { id: compositeId, userId, status: 'draft' },
    data: {
      name: definition.name,
      definition: definition as unknown as Prisma.InputJsonValue,
    },
  });

  if (updated.count === 0) {
    throw new FactorError('factor_not_found');
  }

  const row = await getDatabase().factorComposite.findUniqueOrThrow({
    where: { id: compositeId },
  });

  return compositeResource(row);
}

export async function deleteFactorComposite(userId: string, compositeId: string) {
  const deleted = await getDatabase().factorComposite.deleteMany({
    where: { id: compositeId, userId, status: 'draft' },
  });

  if (deleted.count === 0) {
    throw new FactorError('published_factor_readonly');
  }

  return { ok: true };
}

/**
 * 复制可访问组合及其组件引用，创建当前用户的独立草稿。
 *
 * Copy an accessible composite and its component references into an owned draft.
 */
export async function copyFactorComposite(userId: string, compositeId: string) {
  const source = await getDatabase().factorComposite.findFirst({
    where: {
      id: compositeId,
      userId,
    },
  });

  if (!source) {
    throw new FactorError('factor_not_found');
  }

  const definition = factorPanelCompositeDefinitionV2Schema.safeParse(source.definition);

  if (!definition.success || !source.key) {
    throw new FactorError('factor_analysis_kind_unsupported', { params: { kind: 'composite' } });
  }

  const { key, version } = await nextCopyKey(getDatabase(), userId, source.key);
  const nameBase = source.name.replace(/\s+v\d+$/i, '');
  const name = `${nameBase} v${version}`.slice(0, 80);
  const copiedDefinition = { ...definition.data, key, name };
  const row = await getDatabase().factorComposite.create({
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
