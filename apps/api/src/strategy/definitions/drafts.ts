import { t } from '#i18n/index.js';
import { getDatabase } from '#infra/database/prisma.js';
import type { Locale } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { StrategyError } from '../errors.js';
import type { CreateStrategyInput } from '@jixie/shared/api/strategy';
import { proposeStrategyName, uniqueStrategyName } from './naming.js';

/**
 * 创建归属当前用户的策略草稿并初始化默认配置。
 *
 * Create an owned strategy draft with its initial configuration.
 */
export async function createStrategy(userId: string, input: CreateStrategyInput, locale: Locale) {
  const { messages, prompt, ...candidate } = input;
  let proposedName = candidate.name;

  if (prompt || !proposedName) {
    try {
      proposedName = await proposeStrategyName({
        code: prompt ? undefined : candidate.code,
        prompt,
        locale: locale,
      });
    } catch {
      proposedName = t(locale, 'unnamedStrategy');
    }
  }

  const name = await uniqueStrategyName(
    getDatabase(),
    userId,
    proposedName || t(locale, 'unnamedStrategy'),
  );
  const config = { ...candidate, name };
  const row = await getDatabase().strategy.create({
    data: {
      id: ulid(),
      userId,
      name,
      config: config as unknown as Prisma.InputJsonValue,
      ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}),
    },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });

  return row;
}

/**
 * 按用户归属删除策略并清理关联。
 *
 * Delete an owned strategy and its dependent records.
 */
export async function deleteStrategy(userId: string, strategyId: string) {
  const r = await getDatabase().strategy.deleteMany({
    where: { id: strategyId, userId },
  });

  if (r.count === 0) {
    throw new StrategyError('strategy_not_found');
  }

  return { ok: true };
}
