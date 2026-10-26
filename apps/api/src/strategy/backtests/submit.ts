import type { BacktestJobPayload } from './job-payload.js';
import { getDatabase } from '#infra/database/prisma.js';
import { JobScheduler } from '#jobs/job-scheduler.js';
import { ACTIVE_JOB_STATUSES } from '#jobs/job-service.js';
import type { BacktestConfig, Locale } from '@jixie/shared';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { refreshStrategyName } from '../definitions/naming.js';
import {
  commitStrategyConfig,
  strategyRunKey,
  strategyInputSignature,
  strategyResultSettings,
} from '../definitions/config.js';
import { StrategyError } from '../errors.js';
import { pruneStrategyResults } from '../results/retention.js';
import type {
  StrategyBacktestIdentityQuery,
  StrategyCodeConfigInput,
} from '@jixie/shared/api/strategy';

/**
 * 校验策略和可运行配置，冻结本次输入并提交后台回测任务。
 *
 * Validate the strategy, freeze runnable inputs and submit a background backtest.
 */
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

  const start = await getDatabase().$transaction(async (transaction) => {
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

    await pruneStrategyResults(transaction, { userId, strategyId });

    const committed = await commitStrategyConfig(transaction, userId, strategyId, config);
    const committedConfig = { ...config, name: committed!.name };
    const reportId = ulid();
    const jobId = ulid();
    const payload = {
      task: 'backtest',
      reportId,
      strategyId,
      userId,
      locale,
      config: committedConfig,
    } satisfies BacktestJobPayload;

    await transaction.backtestReport.create({
      data: {
        id: reportId,
        userId,
        strategyId,
        strategyName: committedConfig.name,
        legacyStatus: null,
        legacyError: null,
        settings: strategyResultSettings(committedConfig) as unknown as Prisma.InputJsonValue,
        inputSignature: strategyInputSignature(committedConfig),
        job: {
          create: {
            id: jobId,
            userId,
            kind: 'backtest',
            key: strategyId,
            status: 'queued',
            payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
          },
        },
      },
    });

    await pruneStrategyResults(transaction, { userId, strategyId });

    return { kind: 'ready' as const, jobId, reportId, config: committedConfig };
  });

  if (start.kind === 'not_found') {
    throw new StrategyError('strategy_not_found');
  }

  if (start.kind === 'running') {
    throw new StrategyError('strategy_backtest_in_progress');
  }

  const jobId = start.jobId;

  void refreshStrategyName({
    id: strategyId,
    userId,
    code: start.config.code,
    currentName: start.config.name,
    expectedRunKey: strategyRunKey(start.config),
    locale,
  }).catch((error) => console.error('[jixie] strategy rename failed', error));

  JobScheduler.wake();

  return { jobId, reportId: start.reportId };
}
