import type { z } from 'zod';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/database/prisma.js';
import { commitStrategyConfig } from './config.js';
import { proposeStrategyName, uniqueStrategyName } from './naming.js';
import { ACTIVE_JOB_STATUSES } from '../../infra/jobs/records.js';
import { extractFactorKeys } from '../execution/prepare-factors.js';
import type { createStrategySchema, updateStrategySchema } from './inputs.js';
import { t } from '../../i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failStrategyOperation } from '../operation-errors.js';

export async function createStrategy(
  userId: string,
  input: z.infer<typeof createStrategySchema>,
  locale: Locale,
) {
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

export async function updateStrategy(
  userId: string,
  id: string,
  input: z.infer<typeof updateStrategySchema>,
  locale: Locale,
) {
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
      return failStrategyOperation('invalid', t(locale, 'strategyBacktestInProgress'));
    }

    return result.kind === 'updated'
      ? result.row
      : failStrategyOperation('missing', t(locale, 'strategyNotFound'));
  }

  const row = await prisma.strategy.findFirst({ where: { id, userId }, select: { id: true } });

  if (!row) {
    return failStrategyOperation('missing', t(locale, 'strategyNotFound'));
  }

  const updated = await prisma.strategy.update({
    where: { id },
    data: { ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}) },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });

  return updated;
}

export async function deleteStrategy(userId: string, strategyId: string, locale: Locale) {
  const r = await prisma.strategy.deleteMany({
    where: { id: strategyId, userId: userId },
  });

  if (r.count === 0) {
    return failStrategyOperation('missing', t(locale, 'strategyNotFound'));
  }

  return { ok: true };
}
