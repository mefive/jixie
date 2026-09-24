import { t } from '#i18n/index.js';
import { prisma } from '#infra/database/prisma.js';
import { ACTIVE_JOB_STATUSES } from '#jobs/service.js';
import type { Locale } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { StrategyError } from '../errors.js';
import { extractFactorKeys } from '../factor-inputs/references.js';
import type { CreateStrategyInput, UpdateStrategyInput } from '@jixie/shared/api/strategy';
import { commitStrategyConfig } from './config.js';
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

export async function updateStrategy(userId: string, id: string, input: UpdateStrategyInput) {
  const { config, messages } = input;

  if (config) {
    const result = await prisma.$transaction(async (transaction) => {
      const running = await transaction.job.findFirst({
        where: { userId, kind: 'backtest', key: id, status: { in: ACTIVE_JOB_STATUSES } },
        select: { id: true },
      });

      if (running) {
        return { kind: 'running' as const };
      }

      const row = await commitStrategyConfig(
        transaction,
        userId,
        id,
        config,
        messages as Prisma.InputJsonValue | undefined,
        { forcePrivate: extractFactorKeys(config.code).length > 0 },
      );

      return row ? { kind: 'updated' as const, row } : { kind: 'not_found' as const };
    });

    if (result.kind === 'running') {
      throw new StrategyError('strategy_backtest_in_progress');
    }

    if (result.kind === 'updated') {
      return result.row;
    }
    throw new StrategyError('strategy_not_found');
  }

  const row = await prisma.strategy.findFirst({ where: { id, userId }, select: { id: true } });

  if (!row) {
    throw new StrategyError('strategy_not_found');
  }

  const updated = await prisma.strategy.update({
    where: { id },
    data: { ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}) },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });

  return updated;
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
