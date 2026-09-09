import { Hono } from 'hono';
import { validateJson, validateQuery } from '../infra/http/errors.js';
import { codeConfigSchema } from './runtime/typescript/schema.js';
import { localeFromRequest } from '../infra/http/locale.js';
import { backtestStrategyQuerySchema, backtestJobQuerySchema } from './backtest/inputs.js';
import { submitStrategyBacktest } from './backtest/submit.js';
import {
  findStrategyBacktestJob,
  listStrategyBacktestReports,
  readStrategyBacktestReport,
  readStrategyBacktestJob,
} from './backtest/reports.js';
import { strategyOperationApiError } from './route-errors.js';

export const routes = new Hono();

routes.post(
  '/',
  validateQuery(backtestStrategyQuerySchema),
  validateJson(codeConfigSchema),
  async (c) => {
    try {
      return c.json(
        await submitStrategyBacktest(
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

routes.get('/running', validateQuery(backtestStrategyQuerySchema), async (c) => {
  try {
    return c.json(await findStrategyBacktestJob(c.var.userId, c.req.valid('query')));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

routes.get('/reports', validateQuery(backtestStrategyQuerySchema), async (c) => {
  try {
    return c.json(await listStrategyBacktestReports(c.var.userId, c.req.valid('query')));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

routes.get('/reports/:reportId', async (c) => {
  try {
    return c.json(
      await readStrategyBacktestReport(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

routes.get('/:jobId', validateQuery(backtestJobQuerySchema), async (c) => {
  try {
    return c.json(
      await readStrategyBacktestJob(
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
