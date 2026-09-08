import { ulid } from 'ulid';
import type { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { factorRuntimeVersion } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { BUILTIN_KEYS, BUILTIN_USER_ID } from './builtin-factors.js';
import { validateFactorDefinition } from '../runtime/validate-definition.js';
import { factorLanguage } from './views.js';
import type { createFactorDraftSchema, updateFactorDraftSchema } from './inputs.js';
import { nextCopyKey } from './copy-key.js';
import { t } from '../../i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from '../operation-errors.js';

export async function createFactorDraft(
  userId: string,
  input: z.infer<typeof createFactorDraftSchema>,
  locale: Locale,
) {
  const { key, name, code, analysisKind, language, messages } = input;

  if (
    BUILTIN_KEYS.has(key) ||
    (await prisma.factorComposite.findFirst({
      where: { userId, key },
      select: { id: true },
    }))
  ) {
    return failFactorOperation('invalid', t(locale, 'factorKeyUnavailable'));
  }

  try {
    await validateFactorDefinition(code, analysisKind, language);
  } catch (e) {
    return failFactorOperation(
      'invalid',
      e instanceof Error ? e.message : t(locale, 'factorCodeInvalid'),
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
      return failFactorOperation('invalid', t(locale, 'factorKeyUnavailable'));
    }
    throw error;
  }
}

export async function updateFactorDraft(
  userId: string,
  id: string,
  input: z.infer<typeof updateFactorDraftSchema>,
  locale: Locale,
) {
  const { code, name, messages } = input;

  if (BUILTIN_KEYS.has(id)) {
    return failFactorOperation('invalid', t(locale, 'presetFactorReadonlyEdit'));
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
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  if (existing.status !== 'draft') {
    return failFactorOperation('invalid', t(locale, 'publishedFactorReadonly'));
  }

  if (code !== undefined && code !== existing.code) {
    const pinned = await prisma.factorWeatherPin.count({ where: { factorId: id } });
    if (pinned > 0) {
      return failFactorOperation('invalid', t(locale, 'pinnedFactorReadonlyEdit'));
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
      return failFactorOperation(
        'invalid',
        error instanceof Error ? error.message : t(locale, 'factorCodeInvalid'),
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

  return row;
}

export async function deleteFactorDraft(userId: string, id: string, locale: Locale) {
  if (BUILTIN_KEYS.has(id)) {
    return failFactorOperation('invalid', t(locale, 'presetFactorReadonlyDelete'));
  }

  const factor = await prisma.factor.findFirst({ where: { id, userId }, select: { status: true } });

  if (!factor) {
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  if (factor.status !== 'draft') {
    return failFactorOperation('invalid', t(locale, 'publishedFactorCannotDelete'));
  }

  const pinned = await prisma.factorWeatherPin.count({ where: { factorId: id } });

  if (pinned > 0) {
    return failFactorOperation('invalid', t(locale, 'pinnedFactorReadonlyDelete'));
  }

  await prisma.factor.deleteMany({ where: { id, userId } });

  return { ok: true };
}

export async function copyFactorDraft(userId: string, factorId: string, locale: Locale) {
  const source = await prisma.factor.findFirst({
    where: {
      id: factorId,
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
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
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

  return { id, key, name, status: 'draft' };
}
