import type { StrategyScanJobPayload } from './job-payload.js';
import { inspectStrategyParameters } from './inspect-parameters.js';
import { getDatabase } from '#infra/database/prisma.js';
import { UserCodeError } from '#infra/errors.js';
import { JobScheduler } from '#jobs/job-scheduler.js';
import { ACTIVE_JOB_STATUSES } from '#jobs/job-service.js';
import type { BacktestConfig, Locale, StrategyParamValue, StrategyScanSpec } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { StrategyError } from '../errors.js';

import type {
  StrategyScanIdentityQuery,
  SubmitStrategyScanInput,
} from '@jixie/shared/api/strategy';
import { normalizeScanSpec } from './scan.js';

/**
 * 校验策略与扫描范围，冻结输入并创建后台扫描任务。
 *
 * Validate the strategy and scan scope, freeze inputs and create a background scan job.
 */
export async function submitStrategyScan(
  userId: string,
  input: SubmitStrategyScanInput,
  query: StrategyScanIdentityQuery,
  locale: Locale,
) {
  const { strategyId } = query;
  const body = input;
  const config = body.config as BacktestConfig;

  if ((config.language ?? 'typescript') === 'python') {
    throw new StrategyError('strategy_python_scan_unsupported');
  }

  if (config.start >= config.end) {
    throw new StrategyError('start_after_end', { details: { field: 'start' } });
  }

  let parameters: Record<string, StrategyParamValue>;
  let spec: StrategyScanSpec;

  try {
    parameters = await inspectStrategyParameters(config.code);

    spec = normalizeScanSpec(body.spec as StrategyScanSpec, parameters);
  } catch (error) {
    if (!(error instanceof UserCodeError)) {
      throw error;
    }
    throw new StrategyError('strategy_scan_invalid', {
      cause: error,
      details: {
        reason: error.message,
      },
    });
  }

  if (spec.view !== 'capacity' && Object.keys(parameters).length === 0) {
    throw new StrategyError('strategy_scan_no_parameters');
  }

  const ranges = await resolveRanges(config, spec);

  if (!ranges) {
    throw new StrategyError('strategy_scan_split_invalid');
  }

  const reportId = ulid();
  const jobId = ulid();
  const dataCutoff = (
    await getDatabase().daily.findFirst({
      where: { tradeDate: { lte: config.end } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
  )?.tradeDate;
  const created = await getDatabase().$transaction(async (transaction) => {
    const strategy = await transaction.strategy.findFirst({
      where: { id: strategyId, userId },
      select: { id: true, name: true },
    });

    if (!strategy) {
      return { kind: 'not_found' as const };
    }

    const running = await transaction.job.findFirst({
      where: {
        userId,
        kind: 'strategy-scan',
        key: strategyId,
        status: { in: ACTIVE_JOB_STATUSES },
      },
      select: { id: true },
    });

    if (running) {
      return { kind: 'running' as const };
    }

    await transaction.strategyScanReport.create({
      data: {
        id: reportId,
        userId,
        strategyId,
        strategyName: strategy.name,
        legacyStatus: null,
        legacyError: null,
        config: jsonValue(config),
        spec: jsonValue(spec),
        codeHash: createHash('sha256').update(config.code).digest('hex'),
        dataCutoff,
        job: {
          create: {
            id: jobId,
            userId,
            kind: 'strategy-scan',
            key: strategyId,
            status: 'queued',
            payload: jsonValue({
              task: 'strategy-scan',
              reportId,
              config,
              spec,
              parameters,
              ranges,
              userId,
              locale,
            } satisfies StrategyScanJobPayload),
          },
        },
      },
    });

    return { kind: 'ready' as const };
  });

  if (created.kind === 'not_found') {
    throw new StrategyError('strategy_not_found');
  }

  if (created.kind === 'running') {
    throw new StrategyError('strategy_scan_in_progress');
  }

  JobScheduler.wake();

  return { reportId, jobId };
}

/**
 * 解析各参数扫描区间并校验可执行组合范围。
 *
 * Resolve parameter ranges and validate the executable combination scope.
 */
async function resolveRanges(config: BacktestConfig, spec: StrategyScanSpec) {
  if (!spec.splitDate) {
    return { full: { start: config.start, end: config.end } } as const;
  }

  if (spec.splitDate <= config.start || spec.splitDate >= config.end) {
    return null;
  }

  const [splitDay, nextDay] = await Promise.all([
    getDatabase().tradeCal.findFirst({
      where: { calDate: spec.splitDate, isOpen: 1 },
      select: { calDate: true },
    }),
    getDatabase().tradeCal.findFirst({
      where: { calDate: { gt: spec.splitDate, lte: config.end }, isOpen: 1 },
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
    }),
  ]);

  if (!splitDay || !nextDay) {
    return null;
  }

  return {
    inSample: { start: config.start, end: spec.splitDate },
    outOfSample: { start: nextDay.calDate, end: config.end },
  } as const;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
