import { t } from '#i18n/index.js';
import { prisma } from '#infra/database/prisma.js';
import type { Locale } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { StrategyError } from '../errors.js';
import type { CreateStrategyInput } from '@jixie/shared/api/strategy';
import { proposeStrategyName, uniqueStrategyName } from './naming.js';

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
    prisma,
    userId,
    proposedName || t(locale, 'unnamedStrategy'),
  );
  const config = { ...candidate, name };
  const row = await prisma.strategy.create({
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

export async function deleteStrategy(userId: string, strategyId: string) {
  const r = await prisma.strategy.deleteMany({
    where: { id: strategyId, userId, deployments: { none: {} } },
  });

  if (r.count === 0) {
    const retained = await prisma.strategy.findFirst({
      where: { id: strategyId, userId },
      select: { id: true },
    });
    if (retained) {
      throw new StrategyError('strategy_has_deployments');
    }
    throw new StrategyError('strategy_not_found');
  }

  return { ok: true };
}
