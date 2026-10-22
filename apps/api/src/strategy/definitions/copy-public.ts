import { getDatabase } from '#infra/database/prisma.js';
import type { BacktestConfig } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { StrategyError } from '../errors.js';
import { uniqueStrategyName } from './naming.js';

/**
 * 从可见公开策略创建当前用户独立副本，重置运行身份。
 *
 * Copy an accessible public strategy into an independent owned draft.
 */
export async function copyPublicStrategy(userId: string, strategyId: string) {
  const source = await getDatabase().strategy.findFirst({
    where: { id: strategyId, visibility: 'public' },
    select: { name: true, config: true },
  });
  if (!source) {
    throw new StrategyError('strategy_not_found');
  }
  const name = await uniqueStrategyName(getDatabase(), userId, source.name);
  const config = { ...(source.config as unknown as BacktestConfig), name };
  const copied = await getDatabase().strategy.create({
    data: {
      id: ulid(),
      userId: userId,
      name,
      visibility: 'private',
      config: config as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, name: true },
  });
  return copied;
}
