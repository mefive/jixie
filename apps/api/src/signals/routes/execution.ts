import { signalMarketRevisionSchema } from '@jixie/shared/api/signals';
import { reviseSignalMarketInput } from '../accounting/manual-fills.js';
import {
  signalTaskDecisionSchema,
  resolutionContextSchema,
  signalFillSchema,
  reviseSignalFillSchema,
} from '@jixie/shared/api/signals';
import {
  setSignalTaskDecision,
  getSignalAccountHistory,
  resolveActualSignal,
  recordSignalFill,
  reviseSignalFill,
  retrySignalAccounts,
} from '../accounting/manual-fills.js';
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

signalExecutionRoute.get('/deployments/:deploymentId/executions', async (c) =>
  c.json(await getSignalAccountHistory(c.var.userId, c.req.param('deploymentId'))),
);
signalExecutionRoute.post('/deployments/:deploymentId/account-replays', async (c) =>
  c.json(await retrySignalAccounts(c.var.userId, c.req.param('deploymentId'))),
);
signalExecutionRoute.post(
  '/executions/:executionId/resolutions',
  validateJson(resolutionContextSchema),
  async (c) =>
    c.json(
      await resolveActualSignal(c.var.userId, c.req.param('executionId'), c.req.valid('json')),
    ),
);
signalExecutionRoute.post(
  '/executions/:executionId/fills',
  validateJson(signalFillSchema),
  async (c) =>
    c.json(await recordSignalFill(c.var.userId, c.req.param('executionId'), c.req.valid('json'))),
);
signalExecutionRoute.patch('/fills/:fillId', validateJson(reviseSignalFillSchema), async (c) =>
  c.json(await reviseSignalFill(c.var.userId, c.req.param('fillId'), c.req.valid('json'))),
);

signalExecutionRoute.patch(
  '/executions/:executionId/decision',
  validateJson(signalTaskDecisionSchema),
  async (c) =>
    c.json(
      await setSignalTaskDecision(c.var.userId, c.req.param('executionId'), c.req.valid('json')),
    ),
);

signalExecutionRoute.post(
  '/deployments/:deploymentId/market-input-revisions',
  validateJson(signalMarketRevisionSchema),
  async (c) =>
    c.json(
      await reviseSignalMarketInput(c.var.userId, c.req.param('deploymentId'), c.req.valid('json')),
    ),
);
