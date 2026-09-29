import { StrategyFactor } from '#strategy/factors/factor.js';
import { backtestReportState } from '#strategy/backtests/state.js';
import { inspectStrategyMetadata } from '#strategy/runtime/inspect-definition.js';
import { prisma } from '#infra/database/prisma.js';
import { FactorHost } from '#strategy/execution/factor-host.js';

import { codeConfigSchema } from '@jixie/shared/api/strategy';
import type { BacktestConfig, FactorDependency, Locale, StrategyDeployment } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { SignalsError } from '../errors.js';
import { deploymentWire } from './read.js';

export async function deployBacktestReport(
  userId: string,
  reportId: string,
  locale: Locale,
): Promise<StrategyDeployment> {
  const report = await prisma.backtestReport
    .findFirst({ include: { job: true }, where: { id: reportId, userId } })
    .then((row) => (row ? backtestReportState(row) : row));
  if (!report) {
    throw new SignalsError('report_not_found');
  }
  if (
    report.status !== 'done' ||
    !report.payload ||
    typeof report.payload !== 'object' ||
    Array.isArray(report.payload)
  ) {
    throw new SignalsError('report_not_ready');
  }

  const existing = await prisma.strategyDeployment.findFirst({
    where: { activeReportId: reportId, userId },
  });
  if (existing) {
    return deploymentWire(existing);
  }

  const config = codeConfigSchema.parse(report.config) as BacktestConfig;
  if ((config.language ?? 'typescript') === 'python') {
    throw new SignalsError('language_unsupported');
  }
  const metadata = await inspectStrategyMetadata(config.code);
  const historicalFutureTrades =
    Array.isArray(report.payload.tradeLog) &&
    report.payload.tradeLog.some(
      (trade) =>
        trade && typeof trade === 'object' && !Array.isArray(trade) && trade.assetType === 'future',
    );
  const historicalFutureCapital =
    Array.isArray(report.payload.sleeveNav) &&
    report.payload.sleeveNav.some(
      (point) =>
        point &&
        typeof point === 'object' &&
        !Array.isArray(point) &&
        typeof point.futureValue === 'number' &&
        point.futureValue !== 0,
    );
  if (
    (metadata.accounts?.futures.cashWeight ?? 0) > 0 ||
    historicalFutureTrades ||
    historicalFutureCapital
  ) {
    throw new SignalsError('futures_unsupported');
  }
  // Research-only or archived factors cannot become a new daily-signal dependency.
  const prepared = await StrategyFactor.fromStrategySource(config.code, userId, 'deployment');

  // Deployment has no simulation: inspect once here and release every runtime before persisting.
  const factorHost = new FactorHost(prepared);
  let currentDependencies: FactorDependency[];
  try {
    const { definitions: factorDefinitions } = await factorHost.describe();
    StrategyFactor.validateRuntimeMetadata(prepared, factorDefinitions);
    const byId = new Map(factorDefinitions.map((definition) => [definition.id, definition]));
    currentDependencies = prepared.map((factor) => factor.toDependency(byId.get(factor.key)!));
  } finally {
    factorHost.close();
  }

  // Deployment must use exactly the factor lineage validated by this report.
  let dependencies;
  try {
    dependencies = StrategyFactor.dependenciesFromJson(report.payload.factorDependencies);
    if (dependencies == null && prepared.length > 0) {
      throw new SignalsError('dependencies_changed');
    }
    StrategyFactor.assertDependencies(dependencies, currentDependencies);
  } catch {
    throw new SignalsError('dependencies_changed');
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

  return deploymentWire(row);
}

export async function pauseDeployment(
  userId: string,
  deploymentId: string,
): Promise<StrategyDeployment> {
  const deployment = await prisma.strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
  });
  if (!deployment) {
    throw new SignalsError('deployment_not_found');
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
