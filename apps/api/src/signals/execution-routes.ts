import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { getStrategyExecutionOverview } from './accounting/read.js';
import { updateActualExecution } from './accounting/executions.js';
import { getSignalRun } from './runs/read.js';

export const signalExecutionRoute = new Hono();

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

signalExecutionRoute.get('/deployments/:deploymentId/execution-overview', async (c) => {
  const overview = await getStrategyExecutionOverview(c.var.userId, c.req.param('deploymentId'));
  return overview ? c.json(overview) : apiError(c, 'NOT_FOUND', m(c, 'strategyDeploymentNotFound'));
});

signalExecutionRoute.patch(
  '/executions/:executionId',
  validateJson(actualExecutionSchema),
  async (c) => {
    const result = await updateActualExecution(
      c.var.userId,
      c.req.param('executionId'),
      c.req.valid('json'),
    );
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
  },
);
