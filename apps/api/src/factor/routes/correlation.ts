import { validateJson, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';

import {
  findActiveFactorCorrelationJob,
  readFactorCorrelation,
  readFactorCorrelationJob,
  submitFactorCorrelation,
} from '../correlations/operations.js';
import {
  factorCorrelationQuerySchema,
  factorJobLogsQuerySchema,
  submitFactorCorrelationSchema,
} from '../schema.js';

export const factorCorrelationRoute = new Hono();

factorCorrelationRoute.get(
  '/correlations',
  validateQuery(factorCorrelationQuerySchema),
  async (c) => {
    return c.json(await readFactorCorrelation(c.var.userId, c.req.valid('query')));
  },
);

factorCorrelationRoute.get(
  '/correlation-jobs/active',
  validateQuery(factorCorrelationQuerySchema),
  async (c) => {
    return c.json(await findActiveFactorCorrelationJob(c.var.userId, c.req.valid('query')));
  },
);

factorCorrelationRoute.post(
  '/correlations',
  validateJson(submitFactorCorrelationSchema),
  async (c) => {
    return c.json(
      await submitFactorCorrelation(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  },
);

factorCorrelationRoute.get(
  '/correlation-jobs/:jobId',
  validateQuery(factorJobLogsQuerySchema),
  async (c) => {
    return c.json(
      await readFactorCorrelationJob(c.var.userId, c.req.param('jobId'), c.req.valid('query')),
    );
  },
);
