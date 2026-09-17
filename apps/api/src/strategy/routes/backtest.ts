import { validateJson, validateParam, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import {
  findActiveStrategyBacktestJob,
  listStrategyBacktestReports,
  readStrategyBacktestJob,
  readStrategyBacktestReport,
} from '../backtests/reports.js';
import { submitStrategyBacktest } from '../backtests/submit.js';
import {
  backtestJobQuerySchema,
  backtestStrategyIdentitySchema,
  codeConfigSchema,
} from '@jixie/shared/api/strategy';

export const strategyBacktestRoute = new Hono();

strategyBacktestRoute.post(
  '/:strategyId/backtests',
  validateParam(backtestStrategyIdentitySchema),
  validateJson(codeConfigSchema),
  async (c) => {
    return c.json(
      await submitStrategyBacktest(
        c.var.userId,
        c.req.valid('json'),
        c.req.valid('param'),
        localeFromRequest(c),
      ),
    );
  },
);

strategyBacktestRoute.get(
  '/:strategyId/backtest-jobs/active',
  validateParam(backtestStrategyIdentitySchema),
  async (c) => {
    return c.json(await findActiveStrategyBacktestJob(c.var.userId, c.req.valid('param')));
  },
);

strategyBacktestRoute.get(
  '/:strategyId/backtest-reports',
  validateParam(backtestStrategyIdentitySchema),
  async (c) => {
    return c.json(await listStrategyBacktestReports(c.var.userId, c.req.valid('param')));
  },
);

strategyBacktestRoute.get('/backtest-reports/:reportId', async (c) => {
  return c.json(await readStrategyBacktestReport(c.var.userId, c.req.param('reportId')));
});

strategyBacktestRoute.get(
  '/backtest-jobs/:jobId',
  validateQuery(backtestJobQuerySchema),
  async (c) => {
    return c.json(
      await readStrategyBacktestJob(c.var.userId, c.req.param('jobId'), c.req.valid('query')),
    );
  },
);
