import type { BacktestConfig, StrategyDeployment } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { StrategyFactor } from '#strategy/factors/factor.js';

export async function listStrategyDeployments(
  userId: string,
  strategyId: string,
): Promise<StrategyDeployment[]> {
  const rows = await prisma.strategyDeployment.findMany({
    where: { userId, strategyId },
    orderBy: [{ deployedAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(deploymentWire);
}

export function deploymentWire(row: {
  accountingVersion?: number;
  id: string;
  backtestReportId: string | null;
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
    accountingVersion: row.accountingVersion ?? 1,
    id: row.id,
    backtestReportId: row.backtestReportId,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    status: row.status === 'active' ? 'active' : 'paused',
    config: row.config as unknown as BacktestConfig,
    factorDependencies: StrategyFactor.dependenciesFromJson(row.factorDependencies) ?? [],
    codeHash: row.codeHash,
    locale: row.locale === 'en' ? 'en' : 'zh',
    deployedAt: row.deployedAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
