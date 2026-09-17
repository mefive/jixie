import { validateJson } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { updateActualExecution } from '../accounting/executions.js';
import { getStrategyExecutionOverview } from '../accounting/read.js';
import { getSignalRun } from '../runs/read.js';
import { actualExecutionSchema } from '@jixie/shared/api/signals';

export const signalExecutionRoute = new Hono();

signalExecutionRoute.get('/deployments/:deploymentId/execution-overview', async (c) => {
  const overview = await getStrategyExecutionOverview(c.var.userId, c.req.param('deploymentId'));
  return c.json(overview);
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
    return c.json(await getSignalRun(c.var.userId, result.runId));
  },
);
