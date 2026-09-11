import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { submitSignalRun } from './runs/submit.js';
import { getSignalRun, listSignalRuns, getSignalRunJob } from './runs/read.js';

export const signalRunRoute = new Hono();

const runListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const sinceQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });

signalRunRoute.get('/deployments/:deploymentId/runs', validateQuery(runListQuery), async (c) => {
  const { limit } = c.req.valid('query');
  const runs = await listSignalRuns(c.var.userId, c.req.param('deploymentId'), limit);
  return runs ? c.json(runs) : apiError(c, 'NOT_FOUND', m(c, 'strategyDeploymentNotFound'));
});

signalRunRoute.get('/runs/:runId', async (c) => {
  const run = await getSignalRun(c.var.userId, c.req.param('runId'));
  return run ? c.json(run) : apiError(c, 'NOT_FOUND', m(c, 'signalRunNotFound'));
});

signalRunRoute.post(
  '/deployments/:deploymentId/runs',
  validateJson(
    z.object({
      tradeDate: z
        .string()
        .regex(/^\d{8}$/)
        .optional(),
    }),
  ),
  async (c) => {
    const result = await submitSignalRun(c.var.userId, {
      ...c.req.valid('json'),
      deploymentId: c.req.param('deploymentId'),
    });
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
        return apiError(
          c,
          'VALIDATION_FAILED',
          m(c, 'signalDataNotReady', { date: result.tradeDate }),
        );
    }
  },
);

signalRunRoute.get('/run-jobs/:jobId', validateQuery(sinceQuery), async (c) => {
  const job = await getSignalRunJob(c.var.userId, c.req.param('jobId'), c.req.valid('query').since);
  return job ? c.json(job) : apiError(c, 'NOT_FOUND', m(c, 'signalJobNotFound'));
});
