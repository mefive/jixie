import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { BacktestConfig, Locale, StrategyDeployment } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { codeConfigSchema } from '../../strategy/runtime/typescript/schema.js';
import { inspectWalledStrategyMetadata } from '../../strategy/runtime/typescript/walled-run.js';
import { prepareStrategyFactors } from '../../strategy/execution/prepare-factors.js';
import { prisma } from '../../infra/database/prisma.js';
import { deploymentWire } from './read.js';

export type DeployStrategyResult =
  | { kind: 'ready'; deployment: StrategyDeployment }
  | { kind: 'not_found' }
  | { kind: 'no_backtest' }
  | { kind: 'language_unsupported' }
  | { kind: 'futures_unsupported' };

export async function deployStrategy(
  userId: string,
  strategyId: string,
  locale: Locale,
): Promise<DeployStrategyResult> {
  const strategy = await prisma.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true, name: true, config: true, lastResult: true },
  });
  if (!strategy) {
    return { kind: 'not_found' };
  }
  if (strategy.lastResult == null) {
    return { kind: 'no_backtest' };
  }

  const config = codeConfigSchema.parse(strategy.config) as BacktestConfig;
  if ((config.language ?? 'typescript') === 'python') {
    return { kind: 'language_unsupported' };
  }
  const metadata = await inspectWalledStrategyMetadata(config.code);
  if (metadata.futures.length > 0) {
    return { kind: 'futures_unsupported' };
  }
  // The UI pre-disables this path, but deployment safety is an API invariant: research-only or
  // archived factors must never become a new daily-signal dependency through a direct request.
  const prepared = await prepareStrategyFactors(config.code, userId, locale, 'deployment');

  const frozenConfig = { ...config, name: strategy.name };
  const codeHash = createHash('sha256').update(frozenConfig.code).digest('hex');
  const row = await prisma.$transaction(async (transaction) => {
    await transaction.strategyDeployment.updateMany({
      where: { strategyId, userId, status: 'active' },
      data: { status: 'paused', stoppedAt: new Date() },
    });
    return transaction.strategyDeployment.create({
      data: {
        id: ulid(),
        userId,
        strategyId,
        strategyName: strategy.name,
        status: 'active',
        config: frozenConfig as unknown as Prisma.InputJsonValue,
        factorDependencies: prepared.factors as unknown as Prisma.InputJsonValue,
        codeHash,
        locale,
      },
    });
  });

  return { kind: 'ready', deployment: deploymentWire(row) };
}

export async function pauseDeployment(
  userId: string,
  deploymentId: string,
): Promise<StrategyDeployment | null> {
  const deployment = await prisma.strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
  });
  if (!deployment) {
    return null;
  }
  if (deployment.status === 'paused') {
    return deploymentWire(deployment);
  }
  const updated = await prisma.strategyDeployment.update({
    where: { id: deployment.id },
    data: { status: 'paused', stoppedAt: new Date() },
  });
  return deploymentWire(updated);
}
