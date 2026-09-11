import { Hono } from 'hono';
import { validateJson, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { factorOperationApiError } from './route-errors.js';
import { factorJobLogsQuerySchema } from './analysis/job-queries.js';
import {
  factorCorrelationQuerySchema,
  submitFactorCorrelationSchema,
  readFactorCorrelation,
  findActiveFactorCorrelationJob,
  submitFactorCorrelation,
  readFactorCorrelationJob,
} from './analysis/correlation-operations.js';

export const factorCorrelationRoute = new Hono();

factorCorrelationRoute.get(
  '/correlations',
  validateQuery(factorCorrelationQuerySchema),
  async (c) => {
    try {
      return c.json(
        await readFactorCorrelation(c.var.userId, c.req.valid('query'), localeFromRequest(c)),
      );
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);

factorCorrelationRoute.get(
  '/correlation-jobs/active',
  validateQuery(factorCorrelationQuerySchema),
  async (c) => {
    try {
      return c.json(await findActiveFactorCorrelationJob(c.var.userId, c.req.valid('query')));
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);

factorCorrelationRoute.post(
  '/correlations',
  validateJson(submitFactorCorrelationSchema),
  async (c) => {
    try {
      return c.json(
        await submitFactorCorrelation(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
      );
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);

factorCorrelationRoute.get(
  '/correlation-jobs/:jobId',
  validateQuery(factorJobLogsQuerySchema),
  async (c) => {
    try {
      return c.json(
        await readFactorCorrelationJob(
          c.var.userId,
          c.req.param('jobId'),
          c.req.valid('query'),
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);
