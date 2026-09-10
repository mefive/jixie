import { Hono } from 'hono';
import { localeFromRequest } from '#infra/http/locale.js';
import { validateJson, validateQuery, validateParam } from '#infra/http/errors.js';
import {
  scanStrategyIdentitySchema,
  scanJobQuerySchema,
  strategyScanParametersSchema,
  submitStrategyScanSchema,
} from './scans/inputs.js';
import { inspectStrategyScanParameters } from './scans/parameters.js';
import { submitStrategyScan } from './scans/submit.js';
import {
  listStrategyScanReports,
  findActiveStrategyScanJob,
  readStrategyScanJob,
  readStrategyScanReport,
} from './scans/reports.js';
import { strategyOperationApiError } from './route-errors.js';

export const strategyScanRoute = new Hono();

strategyScanRoute.post(
  '/scan-parameters/inspect',
  validateJson(strategyScanParametersSchema),
  async (c) => {
    try {
      return c.json(await inspectStrategyScanParameters(c.req.valid('json'), localeFromRequest(c)));
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);

strategyScanRoute.post(
  '/:strategyId/scans',
  validateParam(scanStrategyIdentitySchema),
  validateJson(submitStrategyScanSchema),
  async (c) => {
    try {
      return c.json(
        await submitStrategyScan(
          c.var.userId,
          c.req.valid('json'),
          c.req.valid('param'),
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);

strategyScanRoute.get(
  '/:strategyId/scan-reports',
  validateParam(scanStrategyIdentitySchema),
  async (c) => {
    try {
      return c.json(await listStrategyScanReports(c.var.userId, c.req.valid('param')));
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);

strategyScanRoute.get(
  '/:strategyId/scan-jobs/active',
  validateParam(scanStrategyIdentitySchema),
  async (c) => {
    try {
      return c.json(await findActiveStrategyScanJob(c.var.userId, c.req.valid('param')));
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);

strategyScanRoute.get('/scan-jobs/:jobId', validateQuery(scanJobQuerySchema), async (c) => {
  try {
    return c.json(
      await readStrategyScanJob(
        c.var.userId,
        c.req.param('jobId'),
        c.req.valid('query'),
        localeFromRequest(c),
      ),
    );
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

strategyScanRoute.get('/scan-reports/:reportId', async (c) => {
  try {
    return c.json(
      await readStrategyScanReport(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});
