import { createHash } from 'node:crypto';
import type { BacktestConfig, StrategyScanSpec, StrategyParamValue } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import type { z } from 'zod';
import { inspectWalledStrategyParameters } from '../runtime/typescript/walled-run.js';
import { ACTIVE_JOB_STATUSES } from '#infra/jobs/records.js';
import { initializeJobLogs } from '#infra/jobs/logs.js';
import { wakeJobQueue } from '#infra/jobs/queue.js';
import { prisma } from '#infra/database/prisma.js';
import { normalizeScanSpec } from './scan.js';
import type { scanStrategyQuerySchema, submitStrategyScanSchema } from './inputs.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failStrategyOperation } from '../operation-errors.js';

export async function submitStrategyScan(
  userId: string,
  input: z.infer<typeof submitStrategyScanSchema>,
  query: z.infer<typeof scanStrategyQuerySchema>,
  locale: Locale,
) {
  const { strategyId } = query;
  const body = input;
  const config = body.config as BacktestConfig;

  if ((config.language ?? 'typescript') === 'python') {
    return failStrategyOperation('invalid', t(locale, 'strategyPythonScanUnsupported'));
  }

  if (config.start >= config.end) {
    return failStrategyOperation('invalid', t(locale, 'startAfterEnd'), { field: 'start' });
  }

  let parameters: Record<string, StrategyParamValue>;
  let spec: StrategyScanSpec;

  try {
    parameters = await inspectWalledStrategyParameters(config.code);

    spec = normalizeScanSpec(body.spec as StrategyScanSpec, parameters);
  } catch (error) {
    return failStrategyOperation('invalid', t(locale, 'strategyScanInvalid'), {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  if (spec.view !== 'capacity' && Object.keys(parameters).length === 0) {
    return failStrategyOperation('invalid', t(locale, 'strategyScanNoParameters'));
  }

  const ranges = await resolveRanges(config, spec);

  if (!ranges) {
    return failStrategyOperation('invalid', t(locale, 'strategyScanSplitInvalid'));
  }

  const reportId = ulid();
  const jobId = ulid();
  const dataCutoff = (
    await prisma.daily.findFirst({
      where: { tradeDate: { lte: config.end } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
  )?.tradeDate;
  const created = await prisma.$transaction(async (transaction) => {
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
        status: 'running',
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
            }),
          },
        },
      },
    });

    return { kind: 'ready' as const };
  });

  if (created.kind === 'not_found') {
    return failStrategyOperation('missing', t(locale, 'strategyNotFound'));
  }

  if (created.kind === 'running') {
    return failStrategyOperation('invalid', t(locale, 'strategyScanInProgress'));
  }

  initializeJobLogs(jobId);
  wakeJobQueue();

  return { reportId, jobId };
}

async function resolveRanges(config: BacktestConfig, spec: StrategyScanSpec) {
  if (!spec.splitDate) {
    return { full: { start: config.start, end: config.end } } as const;
  }

  if (spec.splitDate <= config.start || spec.splitDate >= config.end) {
    return null;
  }

  const [splitDay, nextDay] = await Promise.all([
    prisma.tradeCal.findFirst({
      where: { calDate: spec.splitDate, isOpen: 1 },
      select: { calDate: true },
    }),
    prisma.tradeCal.findFirst({
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
