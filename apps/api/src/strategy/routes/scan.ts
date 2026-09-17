import { validateJson, validateParam, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import { inspectStrategyScanParameters } from '../scans/parameters.js';
import {
  findActiveStrategyScanJob,
  listStrategyScanReports,
  readStrategyScanJob,
  readStrategyScanReport,
} from '../scans/reports.js';
import { submitStrategyScan } from '../scans/submit.js';
import {
  scanJobQuerySchema,
  scanStrategyIdentitySchema,
  strategyScanParametersSchema,
  submitStrategyScanSchema,
} from '../schema.js';

export const strategyScanRoute = new Hono();

strategyScanRoute.post(
  '/scan-parameters/inspect',
  validateJson(strategyScanParametersSchema),
  async (c) => {
    return c.json(await inspectStrategyScanParameters(c.req.valid('json')));
  },
);

strategyScanRoute.post(
  '/:strategyId/scans',
  validateParam(scanStrategyIdentitySchema),
  validateJson(submitStrategyScanSchema),
  async (c) => {
    return c.json(
      await submitStrategyScan(
        c.var.userId,
        c.req.valid('json'),
        c.req.valid('param'),
        localeFromRequest(c),
      ),
    );
  },
);

strategyScanRoute.get(
  '/:strategyId/scan-reports',
  validateParam(scanStrategyIdentitySchema),
  async (c) => {
    return c.json(await listStrategyScanReports(c.var.userId, c.req.valid('param')));
  },
);

strategyScanRoute.get(
  '/:strategyId/scan-jobs/active',
  validateParam(scanStrategyIdentitySchema),
  async (c) => {
    return c.json(await findActiveStrategyScanJob(c.var.userId, c.req.valid('param')));
  },
);

strategyScanRoute.get('/scan-jobs/:jobId', validateQuery(scanJobQuerySchema), async (c) => {
  return c.json(
    await readStrategyScanJob(c.var.userId, c.req.param('jobId'), c.req.valid('query')),
  );
});

strategyScanRoute.get('/scan-reports/:reportId', async (c) => {
  return c.json(await readStrategyScanReport(c.var.userId, c.req.param('reportId')));
});
