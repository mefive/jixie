import { validateJson, validateQuery } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { getSignalRunJob, listSignalRuns } from '../runs/read.js';
import { submitSignalRun } from '../runs/submit.js';
import {
  signalRunJobQuerySchema,
  signalRunListQuerySchema,
  submitSignalRunBodySchema,
} from '@jixie/shared/api/signals';

export const signalRunRoute = new Hono();

signalRunRoute.get(
  '/deployments/:deploymentId/runs',
  validateQuery(signalRunListQuerySchema),
  async (c) => {
    const { limit } = c.req.valid('query');
    const runs = await listSignalRuns(c.var.userId, c.req.param('deploymentId'), limit);
    return c.json(runs);
  },
);

signalRunRoute.post(
  '/deployments/:deploymentId/runs',
  validateJson(submitSignalRunBodySchema),
  async (c) => {
    const run = await submitSignalRun(c.var.userId, {
      ...c.req.valid('json'),
      deploymentId: c.req.param('deploymentId'),
    });
    return c.json({ runId: run.runId, jobId: run.jobId, started: run.started });
  },
);

signalRunRoute.get('/run-jobs/:jobId', validateQuery(signalRunJobQuerySchema), async (c) => {
  const job = await getSignalRunJob(c.var.userId, c.req.param('jobId'), c.req.valid('query').since);
  return c.json(job);
});
