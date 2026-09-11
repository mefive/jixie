import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest, m } from '#infra/http/locale.js';
import { listStrategyDeployments } from './deployments/read.js';
import { deployBacktestReport, pauseDeployment } from './deployments/manage.js';
import { listDeploymentLatestRuns } from './runs/read.js';

export const signalDeploymentRoute = new Hono();

const strategyQuery = z.object({ strategyId: z.string().min(1) });

signalDeploymentRoute.get('/deployments/latest-runs', async (c) =>
  c.json(await listDeploymentLatestRuns(c.var.userId)),
);

signalDeploymentRoute.get('/deployments', validateQuery(strategyQuery), async (c) => {
  const deployments = await listStrategyDeployments(c.var.userId, c.req.valid('query').strategyId);
  return c.json(deployments);
});

signalDeploymentRoute.post(
  '/deployments',
  validateJson(z.object({ reportId: z.string().min(1) })),
  async (c) => {
    const result = await deployBacktestReport(
      c.var.userId,
      c.req.valid('json').reportId,
      localeFromRequest(c),
    ).catch((error) => ({ kind: 'invalid' as const, error }));
    switch (result.kind) {
      case 'ready':
        return c.json(result.deployment);
      case 'not_found':
        return apiError(c, 'NOT_FOUND', m(c, 'backtestReportNotFound'));
      case 'report_not_ready':
        return apiError(c, 'VALIDATION_FAILED', m(c, 'deploymentReportNotReady'));
      case 'dependencies_changed':
        return apiError(c, 'VALIDATION_FAILED', m(c, 'deploymentReportDependenciesChanged'));
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

signalDeploymentRoute.post('/deployments/:deploymentId/pause', async (c) => {
  const deployment = await pauseDeployment(c.var.userId, c.req.param('deploymentId'));
  return deployment
    ? c.json(deployment)
    : apiError(c, 'NOT_FOUND', m(c, 'strategyDeploymentNotFound'));
});
