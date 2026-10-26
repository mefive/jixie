import { getDatabase } from '#infra/database/prisma.js';
import { UserCodeError } from '#infra/errors.js';
import { factorRuntimeVersion } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { FactorError } from '../errors.js';
import { validateFactorDefinition } from '../sandbox/validate-definition.js';
import type { CreateFactorDraftInput, UpdateFactorDraftInput } from '@jixie/shared/api/factor';
import { BUILTIN_KEYS, BUILTIN_USER_ID } from './builtin-factors.js';
import { nextCopyKey } from './copy-key.js';
import { factorLanguage } from './views.js';

/**
 * 根据指定协议创建因子草稿及初始代码。
 *
 * Create a factor draft and initial source under the chosen protocol.
 */
export async function createFactorDraft(userId: string, input: CreateFactorDraftInput) {
  const { key, name, code, analysisKind, language, messages } = input;

  if (
    BUILTIN_KEYS.has(key) ||
    (await getDatabase().factorComposite.findFirst({
      where: { userId, key },
      select: { id: true },
    }))
  ) {
    throw new FactorError('factor_key_unavailable');
  }

  try {
    await validateFactorDefinition(code, analysisKind, language);
  } catch (e) {
    if (!(e instanceof UserCodeError)) {
      throw e;
    }
    throw new FactorError('code_invalid', { params: { diagnostic: e.message }, cause: e });
  }

  const id = ulid();

  try {
    await getDatabase().factor.create({
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
    return {
      id,
      key,
      name,
      analysisKind,
      language,
      runtimeVersion: factorRuntimeVersion(language),
      status: 'draft',
    };
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
 * 校验归属与不可变协议后更新草稿，维护代码版本与显示元数据。
 *
 * Update an owned draft under its immutable protocol and retain source-version metadata.
 */
export async function updateFactorDraft(userId: string, id: string, input: UpdateFactorDraftInput) {
  const { code, name, messages } = input;

  if (BUILTIN_KEYS.has(id)) {
    throw new FactorError('preset_factor_readonly_edit');
  }

  const existing = await getDatabase().factor.findFirst({
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
    throw new FactorError('factor_not_found');
  }

  if (existing.status !== 'draft') {
    throw new FactorError('published_factor_readonly');
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
      if (!(error instanceof UserCodeError)) {
        throw error;
      }
      throw new FactorError('code_invalid', {
        params: { diagnostic: error.message },
        cause: error,
      });
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

  const row = await getDatabase().factor.update({
    where: { id },
    data,
    select: { id: true, name: true },
  });

  return row;
}

/**
 * 验证因子草稿可删除状态并清理其业务关联。
 *
 * Validate draft deletion eligibility and remove its business associations.
 */
export async function deleteFactorDraft(userId: string, id: string) {
  if (BUILTIN_KEYS.has(id)) {
    throw new FactorError('preset_factor_readonly_delete');
  }

  const factor = await getDatabase().factor.findFirst({
    where: { id, userId },
    select: { status: true },
  });

  if (!factor) {
    throw new FactorError('factor_not_found');
  }

  if (factor.status !== 'draft') {
    throw new FactorError('published_factor_cannot_delete');
  }

  await getDatabase().factor.deleteMany({ where: { id, userId } });

  return { ok: true };
}

/**
 * 从可访问来源创建独立因子草稿，保留来源关联。
 *
 * Create an independent factor draft from an accessible source with provenance.
 */
export async function copyFactorDraft(userId: string, factorId: string) {
  const source = await getDatabase().factor.findFirst({
    where: {
      id: factorId,
      userId: { in: [userId, BUILTIN_USER_ID] },
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
    throw new FactorError('factor_not_found');
  }

  const { key, version } = await nextCopyKey(getDatabase(), userId, source.key);
  const nameBase = source.name.replace(/\s+v\d+$/i, '');
  const name = `${nameBase} v${version}`.slice(0, 40);
  const id = ulid();

  await getDatabase().factor.create({
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

  return { id, key, name, status: 'draft' };
}
