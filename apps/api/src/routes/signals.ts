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
import {
  getStrategyExecutionOverview,
  settleStrategyAccounts,
  updateActualExecution,
} from '../signals/accounting.js';

export const signalsRoute = new Hono();

const strategyQuery = z.object({ strategyId: z.string().min(1) });
const runListQuery = z.object({
  deploymentId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const sinceQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });
const actualExecutionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('filled'),
    shares: z.number().positive(),
    price: z.number().positive(),
    fee: z.number().min(0).optional(),
    reason: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    status: z.literal('skipped'),
    reason: z.string().trim().min(1).max(100),
    note: z.string().trim().max(500).optional(),
  }),
]);

signalsRoute.get('/today', async (c) => c.json(await listTodaySignals(c.var.userId)));

signalsRoute.get('/deployments/current', validateQuery(strategyQuery), async (c) => {
  const deployment = await currentDeployment(c.var.userId, c.req.valid('query').strategyId);
  return c.json({ deployment });
});

signalsRoute.get('/deployments/:id/execution-overview', async (c) => {
  const overview = await getStrategyExecutionOverview(c.var.userId, c.req.param('id'));
  return overview ? c.json(overview) : apiError(c, 'NOT_FOUND', m(c, 'strategyDeploymentNotFound'));
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
      case 'language_unsupported':
        return apiError(c, 'VALIDATION_FAILED', m(c, 'strategyPythonSignalsUnsupported'));
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

signalsRoute.patch('/executions/:id', validateJson(actualExecutionSchema), async (c) => {
  const result = await updateActualExecution(c.var.userId, c.req.param('id'), c.req.valid('json'));
  switch (result.kind) {
    case 'ready': {
      const run = await getSignalRun(c.var.userId, result.runId);
      return run ? c.json(run) : apiError(c, 'NOT_FOUND', m(c, 'signalRunNotFound'));
    }
    case 'not_found':
      return apiError(c, 'NOT_FOUND', m(c, 'signalExecutionNotFound'));
    case 'not_executable':
      return apiError(c, 'VALIDATION_FAILED', m(c, 'signalExecutionUnavailable'));
  }
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
    await settleStrategyAccounts(tradeDate, () => {});
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
