import { Hono } from 'hono';
import { localeFromRequest } from '#infra/http/locale.js';
import { validateJson, validateQuery } from '#infra/http/errors.js';
import {
  scanStrategyQuerySchema,
  scanJobQuerySchema,
  strategyScanParametersSchema,
  submitStrategyScanSchema,
} from './scans/inputs.js';
import { inspectStrategyScanParameters } from './scans/parameters.js';
import { submitStrategyScan } from './scans/submit.js';
import {
  listStrategyScanReports,
  findStrategyScanJob,
  readStrategyScanJob,
  readStrategyScanReport,
} from './scans/reports.js';
import { strategyOperationApiError } from './route-errors.js';

export const routes = new Hono();

routes.post('/parameters', validateJson(strategyScanParametersSchema), async (c) => {
  try {
    return c.json(await inspectStrategyScanParameters(c.req.valid('json'), localeFromRequest(c)));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

routes.post(
  '/',
  validateQuery(scanStrategyQuerySchema),
  validateJson(submitStrategyScanSchema),
  async (c) => {
    try {
      return c.json(
        await submitStrategyScan(
          c.var.userId,
          c.req.valid('json'),
          c.req.valid('query'),
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);

routes.get('/', validateQuery(scanStrategyQuerySchema), async (c) => {
  try {
    return c.json(await listStrategyScanReports(c.var.userId, c.req.valid('query')));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

routes.get('/running', validateQuery(scanStrategyQuerySchema), async (c) => {
  try {
    return c.json(await findStrategyScanJob(c.var.userId, c.req.valid('query')));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

routes.get('/:reportId/job', validateQuery(scanJobQuerySchema), async (c) => {
  try {
    return c.json(
      await readStrategyScanJob(
        c.var.userId,
        c.req.param('reportId'),
        c.req.valid('query'),
        localeFromRequest(c),
      ),
    );
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

routes.get('/:reportId', async (c) => {
  try {
    return c.json(
      await readStrategyScanReport(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});
