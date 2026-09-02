import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import type {
  BacktestConfig,
  BacktestReportDetail,
  BacktestReportSummary,
  BacktestSummary,
} from '@jixie/shared';
import { Prisma } from '@prisma/client';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { codeConfigSchema } from '../strategy/code/schema.js';
import { ACTIVE_JOB_STATUSES, getJob, findRunningJob, initializeJobLogs } from '../lib/jobs.js';
import { wakeJobQueue } from '../lib/job-queue.js';
import { localeFromRequest, m } from '../i18n/index.js';
import { prisma } from '../lib/prisma.js';
import { commitStrategyConfig } from '../services/strategy-service.js';
import { extractFactorKeys } from '../engine/prepare-custom-factors.js';

/**
 * Backtest API (mounted under /api/app/strategy/backtest via strategy.ts — symmetric with
 * /factor/analysis). A backtest is CPU-heavy and would block the HTTP event loop, so it runs in a
 * worker (engine/backtest-worker.ts) as a Job (shared lib/jobs.ts):
 *   POST /?strategyId=X { config }     enqueue a durable Job + report → { jobId, reportId }; the scheduler starts its
 *                                      worker when a bounded slot is available
 *   GET  /running?strategyId=X         an active Job's id (queued or running; re-attach after refresh)
 *   GET  /reports?strategyId=X         completed immutable report history, newest first
 *   GET  /reports/:reportId            one full owned report
 *   GET  /:jobId?since=N               poll the Job: { status, logs, nextSince, error }
 * Status lives in the Job table (durable, cross-client resume); logs stay in-memory; each result lives
 * on an immutable BacktestReport while Strategy.lastResult caches the latest successful run.
 */
export const backtestRoute = new Hono();

const strategyQuery = z.object({ strategyId: z.string().min(1) });
const sinceQuery = z.object({ since: z.string().regex(/^\d+$/).optional() });

backtestRoute.post('/', validateQuery(strategyQuery), validateJson(codeConfigSchema), async (c) => {
  const config = c.req.valid('json') as BacktestConfig;
  const { strategyId } = c.req.valid('query');
  if (config.start >= config.end) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'startAfterEnd'), { field: 'start' });
  }
  const userId = c.var.userId;
  const locale = localeFromRequest(c);

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
    return apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
  }
  if (start.kind === 'running') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyBacktestInProgress'));
  }

  const jobId = start.jobId;
  initializeJobLogs(jobId);
  wakeJobQueue();
  return c.json({ jobId, reportId: start.reportId });
});

// /running must be registered before /:jobId (else it matches the param route).
backtestRoute.get('/running', validateQuery(strategyQuery), async (c) => {
  const jobId = await findRunningJob(c.var.userId, 'backtest', c.req.valid('query').strategyId);
  return c.json({ jobId });
});

// Completed immutable reports for one saved strategy, newest first. The list carries only headline
// metrics; the full NAV and trade log are loaded by report id when selected.
backtestRoute.get('/reports', validateQuery(strategyQuery), async (c) => {
  const reports = await prisma.backtestReport.findMany({
    where: {
      userId: c.var.userId,
      strategyId: c.req.valid('query').strategyId,
      status: 'done',
      payload: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      strategyId: true,
      strategyName: true,
      config: true,
      payload: true,
      createdAt: true,
      computedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return c.json(reports.map(backtestReportSummary));
});

backtestRoute.get('/reports/:reportId', async (c) => {
  const report = await prisma.backtestReport.findFirst({
    where: {
      id: c.req.param('reportId'),
      userId: c.var.userId,
      status: 'done',
      payload: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      strategyId: true,
      strategyName: true,
      config: true,
      codeHash: true,
      resultHash: true,
      payload: true,
      createdAt: true,
      computedAt: true,
    },
  });
  if (!report) {
    return apiError(c, 'NOT_FOUND', m(c, 'backtestReportNotFound'));
  }
  const summary = backtestReportSummary(report);
  const detail: BacktestReportDetail = {
    ...summary,
    config: report.config as unknown as BacktestConfig,
    result: report.payload as unknown as BacktestSummary,
    codeHash: report.codeHash,
    resultHash: report.resultHash,
  };
  return c.json(detail);
});

backtestRoute.get('/:jobId', validateQuery(sinceQuery), async (c) => {
  const job = await getJob(
    c.var.userId,
    c.req.param('jobId'),
    Number(c.req.valid('query').since ?? '0'),
  );
  if (!job) {
    return apiError(c, 'NOT_FOUND', m(c, 'backtestJobNotFound'));
  }
  return c.json(job);
});

function backtestReportSummary(report: {
  id: string;
  strategyId: string;
  strategyName: string;
  config: unknown;
  payload: unknown;
  createdAt: Date;
  computedAt: Date | null;
}): BacktestReportSummary {
  const config = report.config as BacktestConfig;
  const result = report.payload as BacktestSummary;
  return {
    id: report.id,
    strategyId: report.strategyId,
    strategyName: report.strategyName,
    status: 'done',
    start: config.start,
    end: config.end,
    language: config.language ?? 'typescript',
    totalReturn: result.totalReturn,
    annReturn: result.annReturn,
    sharpe: result.sharpe,
    maxDrawdown: result.maxDrawdown,
    trades: result.trades,
    createdAt: report.createdAt.toISOString(),
    computedAt: report.computedAt?.toISOString() ?? null,
  };
}
