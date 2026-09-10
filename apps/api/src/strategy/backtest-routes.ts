import { Hono } from 'hono';
import { validateJson, validateQuery, validateParam } from '#infra/http/errors.js';
import { codeConfigSchema } from './runtime/typescript/schema.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { backtestStrategyIdentitySchema, backtestJobQuerySchema } from './backtest/inputs.js';
import { submitStrategyBacktest } from './backtest/submit.js';
import {
  findActiveStrategyBacktestJob,
  listStrategyBacktestReports,
  readStrategyBacktestReport,
  readStrategyBacktestJob,
} from './backtest/reports.js';
import { strategyOperationApiError } from './route-errors.js';

export const strategyBacktestRoute = new Hono();

strategyBacktestRoute.post(
  '/:strategyId/backtests',
  validateParam(backtestStrategyIdentitySchema),
  validateJson(codeConfigSchema),
  async (c) => {
    try {
      return c.json(
        await submitStrategyBacktest(
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

strategyBacktestRoute.get(
  '/:strategyId/backtest-jobs/active',
  validateParam(backtestStrategyIdentitySchema),
  async (c) => {
    try {
      return c.json(await findActiveStrategyBacktestJob(c.var.userId, c.req.valid('param')));
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);

strategyBacktestRoute.get(
  '/:strategyId/backtest-reports',
  validateParam(backtestStrategyIdentitySchema),
  async (c) => {
    try {
      return c.json(await listStrategyBacktestReports(c.var.userId, c.req.valid('param')));
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);

strategyBacktestRoute.get('/backtest-reports/:reportId', async (c) => {
  try {
    return c.json(
      await readStrategyBacktestReport(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

strategyBacktestRoute.get(
  '/backtest-jobs/:jobId',
  validateQuery(backtestJobQuerySchema),
  async (c) => {
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
  },
);
