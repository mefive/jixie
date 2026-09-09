import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { ulid } from 'ulid';
import type { BacktestConfig } from '@jixie/shared';
import { Prisma } from '@prisma/client';
import type { codeConfigSchema } from '../runtime/typescript/schema.js';
import { ACTIVE_JOB_STATUSES } from '../../infra/jobs/records.js';
import { initializeJobLogs } from '../../infra/jobs/logs.js';
import { wakeJobQueue } from '../../infra/jobs/queue.js';
import { prisma } from '../../infra/database/prisma.js';
import { commitStrategyConfig } from '../definitions/config.js';
import { extractFactorKeys } from '../execution/prepare-factors.js';
import type { backtestStrategyQuerySchema } from './inputs.js';
import { t } from '../../i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failStrategyOperation } from '../operation-errors.js';

export async function submitStrategyBacktest(
  userId: string,
  input: z.infer<typeof codeConfigSchema>,
  query: z.infer<typeof backtestStrategyQuerySchema>,
  locale: Locale,
) {
  const config = input as BacktestConfig;
  const { strategyId } = query;

  if (config.start >= config.end) {
    return failStrategyOperation('invalid', t(locale, 'startAfterEnd'), { field: 'start' });
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
    return failStrategyOperation('missing', t(locale, 'strategyNotFound'));
  }

  if (start.kind === 'running') {
    return failStrategyOperation('invalid', t(locale, 'strategyBacktestInProgress'));
  }

  const jobId = start.jobId;

  initializeJobLogs(jobId);
  wakeJobQueue();

  return { jobId, reportId: start.reportId };
}
