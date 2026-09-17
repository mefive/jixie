import { prisma } from '#infra/database/prisma.js';
import { initializeJobLogs } from '#infra/jobs/logs.js';
import { wakeJobQueue } from '#infra/jobs/queue.js';
import { ACTIVE_JOB_STATUSES } from '#infra/jobs/records.js';
import type { BacktestConfig, Locale } from '@jixie/shared';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { commitStrategyConfig } from '../definitions/config.js';
import { StrategyError } from '../errors.js';
import { extractFactorKeys } from '../factor-inputs/references.js';
import type { StrategyBacktestIdentityQuery, StrategyCodeConfigInput } from '../schema.js';

export async function submitStrategyBacktest(
  userId: string,
  input: StrategyCodeConfigInput,
  query: StrategyBacktestIdentityQuery,
  locale: Locale,
) {
  const config = input as BacktestConfig;
  const { strategyId } = query;

  if (config.start >= config.end) {
    throw new StrategyError('start_after_end', { details: { field: 'start' } });
  }

  const start = await prisma.$transaction(async (transaction) => {
    const strategy = await transaction.strategy.findFirst({
      where: { id: strategyId, userId },
      select: { id: true },
    });

    if (!strategy) {
      return { kind: 'not_found' as const };
    }

    const running = await transaction.job.findFirst({
      where: { userId, kind: 'backtest', key: strategyId, status: { in: ACTIVE_JOB_STATUSES } },
      select: { id: true },
    });

    if (running) {
      return { kind: 'running' as const };
    }

    const committed = await commitStrategyConfig(
      transaction,
      userId,
      strategyId,
      config,
      undefined,
      {
        forcePrivate: extractFactorKeys(config.code).length > 0,
      },
    );
    const committedConfig = { ...config, name: committed!.name };
    const reportId = ulid();
    const jobId = ulid();

    await transaction.backtestReport.create({
      data: {
        id: reportId,
        userId,
        strategyId,
        strategyName: committedConfig.name,
        status: 'running',
        config: JSON.parse(JSON.stringify(committedConfig)) as Prisma.InputJsonValue,
        codeHash: createHash('sha256').update(committedConfig.code).digest('hex'),
        job: {
          create: {
            id: jobId,
            userId,
            kind: 'backtest',
            key: strategyId,
            status: 'queued',
            payload: JSON.parse(
              JSON.stringify({
                task: 'backtest',
                reportId,
                strategyId,
                userId,
                locale,
                config: committedConfig,
              }),
            ) as Prisma.InputJsonValue,
          },
        },
      },
    });

    return { kind: 'ready' as const, jobId, reportId };
  });

  if (start.kind === 'not_found') {
    throw new StrategyError('strategy_not_found');
  }

  if (start.kind === 'running') {
    throw new StrategyError('strategy_backtest_in_progress');
  }

  const jobId = start.jobId;

  initializeJobLogs(jobId);
  wakeJobQueue();

  return { jobId, reportId: start.reportId };
}
