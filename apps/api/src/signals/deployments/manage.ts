import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { BacktestConfig, Locale, StrategyDeployment } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { codeConfigSchema } from '#strategy/runtime/typescript/schema.js';
import { inspectWalledStrategyMetadata } from '#strategy/runtime/typescript/walled-run.js';
import { prepareStrategyFactors } from '#strategy/execution/prepare-factors.js';
import { prisma } from '#infra/database/prisma.js';
import { assertFactorDependencies, factorDependenciesFromJson } from '../factor-inputs/lineage.js';
import { deploymentWire } from './read.js';

export type DeployBacktestReportResult =
  | { kind: 'ready'; deployment: StrategyDeployment }
  | { kind: 'not_found' }
  | { kind: 'report_not_ready' }
  | { kind: 'dependencies_changed' }
  | { kind: 'language_unsupported' }
  | { kind: 'futures_unsupported' };

export async function deployBacktestReport(
  userId: string,
  reportId: string,
  locale: Locale,
): Promise<DeployBacktestReportResult> {
  const report = await prisma.backtestReport.findFirst({
    where: { id: reportId, userId },
  });
  if (!report) {
    return { kind: 'not_found' };
  }
  if (
    report.status !== 'done' ||
    !report.payload ||
    typeof report.payload !== 'object' ||
    Array.isArray(report.payload)
  ) {
    return { kind: 'report_not_ready' };
  }

  const existing = await prisma.strategyDeployment.findFirst({
    where: { activeReportId: reportId, userId },
  });
  if (existing) {
    return { kind: 'ready', deployment: deploymentWire(existing) };
  }

  const config = codeConfigSchema.parse(report.config) as BacktestConfig;
  if ((config.language ?? 'typescript') === 'python') {
    return { kind: 'language_unsupported' };
  }
  const metadata = await inspectWalledStrategyMetadata(config.code);
  if (metadata.futures.length > 0) {
    return { kind: 'futures_unsupported' };
  }
  // Research-only or archived factors cannot become a new daily-signal dependency.
  const prepared = await prepareStrategyFactors(config.code, userId, locale, 'deployment');

  // Deployment must use exactly the factor lineage validated by this report.
  let dependencies;
  try {
    dependencies = factorDependenciesFromJson(report.payload.factorDependencies);
    if (dependencies == null && prepared.factors.length > 0) {
      return { kind: 'dependencies_changed' };
    }
    assertFactorDependencies(dependencies, prepared.factors);
  } catch {
    return { kind: 'dependencies_changed' };
  }

  const frozenConfig = { ...config, name: report.strategyName };
  const codeHash = createHash('sha256').update(frozenConfig.code).digest('hex');
  const create = {
    id: ulid(),
    userId,
    strategyId: report.strategyId,
    backtestReportId: report.id,
    activeReportId: report.id,
    strategyName: report.strategyName,
    status: 'active',
    config: frozenConfig as unknown as Prisma.InputJsonValue,
    factorDependencies: (dependencies ?? []) as unknown as Prisma.InputJsonValue,
    codeHash,
    locale,
  };
  // A unique nullable key makes concurrent requests idempotent without pausing other reports.
  const row = await prisma.strategyDeployment
    .upsert({
      where: { activeReportId: report.id },
      create,
      update: {},
    })
    .catch(async (error: unknown) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const winner = await prisma.strategyDeployment.findFirst({
          where: { activeReportId: report.id, userId },
        });
        if (winner) {
          return winner;
        }
      }
      throw error;
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
    data: { status: 'paused', activeReportId: null, stoppedAt: new Date() },
  });
  return deploymentWire(updated);
}
