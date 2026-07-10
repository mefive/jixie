import { Worker } from 'node:worker_threads';
import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import type { BacktestConfig, LogLine } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { codeConfigSchema } from '../strategy/code/schema.js';
import { appendLog, finishJob, getJob, findRunningJob, initializeJobLogs } from '../lib/jobs.js';
import { localeFromRequest, m } from '../i18n/index.js';
import { prisma } from '../lib/prisma.js';
import {
  commitStrategyConfig,
  refreshStrategyName,
  strategyRunKey,
} from '../services/strategy-service.js';

/**
 * Backtest API (mounted under /api/app/strategy/backtest via strategy.ts — symmetric with
 * /factor/analysis). A backtest is CPU-heavy and would block the HTTP event loop, so it runs in a
 * worker (engine/backtest-worker.ts) as a Job (shared lib/jobs.ts):
 *   POST /?strategyId=X { config }     start a Job + spawn the worker → { jobId }; the worker streams
 *                                      progress logs and, on done, writes the result to Strategy.lastResult
 *   GET  /running?strategyId=X         a still-running Job's id (re-attach after a refresh — DB-backed)
 *   GET  /:jobId?since=N               poll the Job: { status, logs, nextSince, error }
 * Status lives in the Job table (durable, cross-client resume); logs stay in-memory; the result lives
 * on the Strategy (not the Job).
 */
export const backtestRoute = new Hono();

// Worker entry: dev (tsx) spawns the .mjs bootstrap; prod spawns the compiled .js.
const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../engine/backtest-worker.boot.mjs', import.meta.url)
  : new URL('../engine/backtest-worker.js', import.meta.url);

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
      where: { userId, kind: 'backtest', key: strategyId, status: 'running' },
      select: { id: true },
    });
    if (running) {
      return { kind: 'running' as const };
    }

    const committed = await commitStrategyConfig(transaction, userId, strategyId, config);
    const jobId = ulid();
    await transaction.job.create({
      data: { id: jobId, userId, kind: 'backtest', key: strategyId, status: 'running' },
    });
    return { kind: 'ready' as const, jobId, name: committed!.name };
  });
  if (start.kind === 'not_found') {
    return apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
  }
  if (start.kind === 'running') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyBacktestInProgress'));
  }

  const committedConfig = { ...config, name: start.name };
  const renamePromise = refreshStrategyName({
    id: strategyId,
    userId,
    code: committedConfig.code,
    currentName: committedConfig.name,
    expectedRunKey: strategyRunKey(committedConfig),
    locale,
  }).catch((error) => {
    console.error('[jixie] strategy rename failed', error);
    return false;
  });

  const jobId = start.jobId;
  initializeJobLogs(jobId);
  let worker: Worker;
  try {
    worker = new Worker(workerUrl, {
      workerData: { config: committedConfig, userId, strategyId, locale },
    });
  } catch (error) {
    await finishJob(jobId, 'error', error instanceof Error ? error.message : String(error));
    return apiError(c, 'SERVICE_UNAVAILABLE', m(c, 'backtestStartFailed'));
  }
  let finished = false;
  const done = (status: 'done' | 'error', error?: string) => {
    if (finished) {
      return;
    }
    finished = true;
    void finishJob(jobId, status, error);
  };
  worker.on('message', (msg: { type: string; entry?: LogLine; message?: string }) => {
    if (msg.type === 'log') {
      appendLog(jobId, msg.entry!);
    } else if (msg.type === 'done') {
      void renamePromise.finally(() => done('done'));
    } else if (msg.type === 'error') {
      done('error', msg.message);
    }
  });
  worker.on('error', (err) => done('error', err.message));
  worker.on('exit', (code) => {
    if (code !== 0) {
      done('error', m(c, 'backtestProcExited', { code }));
    }
  });
  return c.json({ jobId });
});

// /running must be registered before /:jobId (else it matches the param route).
backtestRoute.get('/running', validateQuery(strategyQuery), async (c) => {
  const jobId = await findRunningJob(c.var.userId, 'backtest', c.req.valid('query').strategyId);
  return c.json({ jobId });
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
