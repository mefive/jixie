import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type {
  BacktestConfig,
  StrategyScanPayload,
  StrategyScanReport,
  StrategyScanReportSummary,
  StrategyScanSpec,
  StrategyParamValue,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { inspectWalledStrategyParameters } from '../engine/walled-run.js';
import { localeFromRequest, m } from '../i18n/index.js';
import { appendLog, finishStrategyScanJob, getJob, initializeJobLogs } from '../lib/jobs.js';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { normalizeScanSpec } from '../strategy/scan.js';
import { codeConfigSchema } from '../strategy/code/schema.js';

export const strategyScansRoute = new Hono();

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../engine/strategy-scan-worker.boot.mjs', import.meta.url)
  : new URL('../engine/strategy-scan-worker.js', import.meta.url);

const strategyQuery = z.object({ strategyId: z.string().min(1) });
const sinceQuery = z.object({ since: z.string().regex(/^\d+$/).optional() });
const parametersBody = z.object({ code: z.string().min(1).max(50_000) });
const scanSpecSchema = z.object({
  dimensions: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        values: z
          .array(z.union([z.number().finite(), z.string().trim().min(1).max(100)]))
          .min(2)
          .max(25),
      }),
    )
    .min(1)
    .max(2),
  splitDate: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  view: z.enum(['parameters', 'sizing', 'capacity']).optional(),
});
const createBody = z.object({
  config: codeConfigSchema,
  spec: scanSpecSchema,
});

strategyScansRoute.post('/parameters', validateJson(parametersBody), async (c) => {
  try {
    const parameters = await inspectWalledStrategyParameters(c.req.valid('json').code);
    return c.json({ parameters });
  } catch (error) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyScanCodeInvalid'), {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
});

strategyScansRoute.post('/', validateQuery(strategyQuery), validateJson(createBody), async (c) => {
  const { strategyId } = c.req.valid('query');
  const body = c.req.valid('json');
  const config = body.config as BacktestConfig;
  if (config.start >= config.end) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'startAfterEnd'), { field: 'start' });
  }

  let parameters: Record<string, StrategyParamValue>;
  let spec: StrategyScanSpec;
  try {
    parameters = await inspectWalledStrategyParameters(config.code);
    spec = normalizeScanSpec(body.spec as StrategyScanSpec, parameters);
  } catch (error) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyScanInvalid'), {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (spec.view !== 'capacity' && Object.keys(parameters).length === 0) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyScanNoParameters'));
  }

  const ranges = await resolveRanges(config, spec);
  if (!ranges) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyScanSplitInvalid'));
  }

  const userId = c.var.userId;
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
      where: { userId, kind: 'strategy-scan', key: strategyId, status: 'running' },
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
            status: 'running',
          },
        },
      },
    });
    return { kind: 'ready' as const };
  });
  if (created.kind === 'not_found') {
    return apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
  }
  if (created.kind === 'running') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyScanInProgress'));
  }

  initializeJobLogs(jobId);
  let worker: Worker;
  try {
    worker = new Worker(workerUrl, {
      workerData: {
        config,
        spec,
        parameters,
        ranges,
        userId,
        locale: localeFromRequest(c),
      },
    });
  } catch (error) {
    await finishStrategyScanJob(
      jobId,
      reportId,
      'error',
      undefined,
      error instanceof Error ? error.message : String(error),
    );
    return apiError(c, 'SERVICE_UNAVAILABLE', m(c, 'strategyScanStartFailed'));
  }

  let finished = false;
  const finish = (status: 'done' | 'error', payload?: StrategyScanPayload, error?: string) => {
    if (finished) {
      return;
    }
    finished = true;
    void finishStrategyScanJob(
      jobId,
      reportId,
      status,
      payload ? jsonValue(payload) : undefined,
      error,
    );
  };
  worker.on(
    'message',
    (message: {
      type: string;
      entry?: Parameters<typeof appendLog>[1];
      payload?: StrategyScanPayload;
      message?: string;
    }) => {
      switch (message.type) {
        case 'log':
          appendLog(jobId, message.entry!);
          break;
        case 'done':
          finish('done', message.payload);
          break;
        case 'error':
          finish('error', undefined, message.message);
          break;
      }
    },
  );
  worker.on('error', (error) => finish('error', undefined, error.message));
  worker.on('exit', (code) => {
    if (code !== 0) {
      finish('error', undefined, m(c, 'strategyScanProcExited', { code }));
    }
  });

  return c.json({ reportId, jobId });
});

strategyScansRoute.get('/', validateQuery(strategyQuery), async (c) => {
  const rows = await prisma.strategyScanReport.findMany({
    where: { userId: c.var.userId, strategyId: c.req.valid('query').strategyId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return c.json(rows.map(toSummary));
});

strategyScansRoute.get('/running', validateQuery(strategyQuery), async (c) => {
  const row = await prisma.strategyScanReport.findFirst({
    where: {
      userId: c.var.userId,
      strategyId: c.req.valid('query').strategyId,
      status: 'running',
      job: { status: 'running' },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, job: { select: { id: true } } },
  });
  return c.json({ reportId: row?.id ?? null, jobId: row?.job?.id ?? null });
});

strategyScansRoute.get('/:reportId/job', validateQuery(sinceQuery), async (c) => {
  const report = await prisma.strategyScanReport.findFirst({
    where: { id: c.req.param('reportId'), userId: c.var.userId },
    select: { job: { select: { id: true } } },
  });
  if (!report?.job) {
    return apiError(c, 'NOT_FOUND', m(c, 'strategyScanJobNotFound'));
  }
  const job = await getJob(c.var.userId, report.job.id, Number(c.req.valid('query').since ?? '0'));
  if (!job) {
    return apiError(c, 'NOT_FOUND', m(c, 'strategyScanJobNotFound'));
  }
  return c.json(job);
});

strategyScansRoute.get('/:reportId', async (c) => {
  const row = await prisma.strategyScanReport.findFirst({
    where: { id: c.req.param('reportId'), userId: c.var.userId },
    include: { job: { select: { id: true } } },
  });
  if (!row?.job) {
    return apiError(c, 'NOT_FOUND', m(c, 'strategyScanNotFound'));
  }
  return c.json(toReport(row));
});

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

function toSummary(row: {
  id: string;
  strategyId: string;
  strategyName: string;
  status: string;
  spec: Prisma.JsonValue;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StrategyScanReportSummary {
  return {
    id: row.id,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    status: row.status as StrategyScanReportSummary['status'],
    spec: row.spec as unknown as StrategyScanSpec,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toReport(row: {
  id: string;
  strategyId: string;
  strategyName: string;
  status: string;
  config: Prisma.JsonValue;
  spec: Prisma.JsonValue;
  codeHash: string;
  dataCutoff: string | null;
  payload: Prisma.JsonValue | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  job: { id: string } | null;
}): StrategyScanReport {
  return {
    id: row.id,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    status: row.status as StrategyScanReport['status'],
    config: row.config as unknown as BacktestConfig,
    spec: row.spec as unknown as StrategyScanSpec,
    codeHash: row.codeHash,
    dataCutoff: row.dataCutoff,
    payload: (row.payload as unknown as StrategyScanPayload) ?? undefined,
    error: row.error ?? undefined,
    jobId: row.job!.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
