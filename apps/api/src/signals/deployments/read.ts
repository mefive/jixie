import type { BacktestConfig, StrategyDeployment } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { factorDependenciesFromJson } from '../factor-inputs/lineage.js';

export async function currentDeployment(
  userId: string,
  strategyId: string,
): Promise<StrategyDeployment | null> {
  const row = await prisma.strategyDeployment.findFirst({
    where: { userId, strategyId, status: 'active' },
    orderBy: { deployedAt: 'desc' },
  });
  return row ? deploymentWire(row) : null;
}

export function deploymentWire(row: {
  id: string;
  strategyId: string;
  strategyName: string;
  status: string;
  config: unknown;
  factorDependencies: unknown;
  codeHash: string;
  locale: string;
  deployedAt: Date;
  stoppedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): StrategyDeployment {
  return {
    id: row.id,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    status: row.status === 'active' ? 'active' : 'paused',
    config: row.config as unknown as BacktestConfig,
    factorDependencies: factorDependenciesFromJson(row.factorDependencies) ?? [],
    codeHash: row.codeHash,
    locale: row.locale === 'en' ? 'en' : 'zh',
    deployedAt: row.deployedAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
