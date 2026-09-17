import { validateJson, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import { deployBacktestReport, pauseDeployment } from '../deployments/manage.js';
import { listStrategyDeployments } from '../deployments/read.js';
import { listDeploymentLatestRuns } from '../runs/read.js';
import { createDeploymentBodySchema, deploymentListQuerySchema } from '../schema.js';

export const signalDeploymentRoute = new Hono();

signalDeploymentRoute.get('/deployments/latest-runs', async (c) =>
  c.json(await listDeploymentLatestRuns(c.var.userId)),
);

signalDeploymentRoute.get('/deployments', validateQuery(deploymentListQuerySchema), async (c) => {
  const deployments = await listStrategyDeployments(c.var.userId, c.req.valid('query').strategyId);
  return c.json(deployments);
});

signalDeploymentRoute.post('/deployments', validateJson(createDeploymentBodySchema), async (c) => {
  return c.json(
    await deployBacktestReport(c.var.userId, c.req.valid('json').reportId, localeFromRequest(c)),
  );
});

signalDeploymentRoute.post('/deployments/:deploymentId/pause', async (c) => {
  const deployment = await pauseDeployment(c.var.userId, c.req.param('deploymentId'));
  return c.json(deployment);
});
