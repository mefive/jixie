import { ulid } from 'ulid';
import type { BacktestConfig } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '#infra/database/prisma.js';
import { uniqueStrategyName } from './naming.js';

export async function copyPublicStrategy(userId: string, strategyId: string) {
  const source = await prisma.strategy.findFirst({
    where: { id: strategyId, visibility: 'public' },
    select: { name: true, config: true },
  });
  if (!source) {
    return null;
  }
  const name = await uniqueStrategyName(prisma, userId, source.name);
  const config = { ...(source.config as unknown as BacktestConfig), name };
  const copied = await prisma.strategy.create({
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
