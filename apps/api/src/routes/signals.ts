import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { getJob } from '../lib/jobs.js';
import { localeFromRequest, m } from '../i18n/index.js';
import {
  currentDeployment,
  deployStrategy,
  enqueueSignalRun,
  getSignalRun,
  latestCompletedTradeDate,
  listSignalRuns,
  listTodaySignals,
  pauseDeployment,
} from '../signals/service.js';

export const signalsRoute = new Hono();

const strategyQuery = z.object({ strategyId: z.string().min(1) });
const runListQuery = z.object({
  deploymentId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const sinceQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });

signalsRoute.get('/today', async (c) => c.json(await listTodaySignals(c.var.userId)));

signalsRoute.get('/deployments/current', validateQuery(strategyQuery), async (c) => {
  const deployment = await currentDeployment(c.var.userId, c.req.valid('query').strategyId);
  return c.json({ deployment });
});

signalsRoute.post(
  '/deployments',
  validateJson(z.object({ strategyId: z.string().min(1) })),
  async (c) => {
    const result = await deployStrategy(
      c.var.userId,
      c.req.valid('json').strategyId,
      localeFromRequest(c),
    ).catch((error) => ({ kind: 'invalid' as const, error }));
    switch (result.kind) {
      case 'ready':
        return c.json(result.deployment);
      case 'not_found':
        return apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
      case 'no_backtest':
        return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyNeedsBacktestBeforeDeploy'));
      case 'futures_unsupported':
        return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyFutureSignalsUnsupported'));
      case 'invalid':
        return apiError(
          c,
          'VALIDATION_FAILED',
          result.error instanceof Error ? result.error.message : m(c, 'invalidInput'),
        );
    }
  },
);

signalsRoute.post('/deployments/:id/pause', async (c) => {
  const deployment = await pauseDeployment(c.var.userId, c.req.param('id'));
  return deployment
    ? c.json(deployment)
    : apiError(c, 'NOT_FOUND', m(c, 'strategyDeploymentNotFound'));
});

signalsRoute.get('/runs', validateQuery(runListQuery), async (c) => {
  const { deploymentId, limit } = c.req.valid('query');
  const runs = await listSignalRuns(c.var.userId, deploymentId, limit);
  return runs ? c.json(runs) : apiError(c, 'NOT_FOUND', m(c, 'strategyDeploymentNotFound'));
});

signalsRoute.get('/runs/:id', async (c) => {
  const run = await getSignalRun(c.var.userId, c.req.param('id'));
  return run ? c.json(run) : apiError(c, 'NOT_FOUND', m(c, 'signalRunNotFound'));
});

signalsRoute.post(
  '/run',
  validateJson(
    z.object({
      deploymentId: z.string().min(1),
      tradeDate: z
        .string()
        .regex(/^\d{8}$/)
        .optional(),
    }),
  ),
  async (c) => {
    const { deploymentId, tradeDate: requestedDate } = c.req.valid('json');
    const tradeDate = requestedDate ?? (await latestCompletedTradeDate());
    if (!tradeDate) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'signalTradeDateInvalid'));
    }
    const result = await enqueueSignalRun(c.var.userId, deploymentId, tradeDate);
    switch (result.kind) {
      case 'ready':
        return c.json({
          runId: result.run.runId,
          jobId: result.run.jobId,
          started: result.run.started,
        });
      case 'not_found':
        return apiError(c, 'NOT_FOUND', m(c, 'strategyDeploymentNotFound'));
      case 'paused':
        return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyDeploymentPaused'));
      case 'invalid_date':
        return apiError(c, 'VALIDATION_FAILED', m(c, 'signalTradeDateInvalid'));
      case 'next_date_missing':
        return apiError(c, 'VALIDATION_FAILED', m(c, 'signalNextTradeDateMissing'));
      case 'data_not_ready':
        return apiError(c, 'VALIDATION_FAILED', m(c, 'signalDataNotReady', { date: tradeDate }));
    }
  },
);

signalsRoute.get('/jobs/:jobId', validateQuery(sinceQuery), async (c) => {
  const job = await getJob(c.var.userId, c.req.param('jobId'), c.req.valid('query').since);
  return job ? c.json(job) : apiError(c, 'NOT_FOUND', m(c, 'signalJobNotFound'));
});
