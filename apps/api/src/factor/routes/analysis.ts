import { validateJson, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';

import { listFactorReports, readFactorAnalysisJob, readFactorReport } from '../evaluations/read.js';
import { submitFactorAnalysis } from '../evaluations/submit.js';
import {
  factorJobLogsQuerySchema,
  factorReportListQuerySchema,
  submitFactorAnalysisSchema,
} from '@jixie/shared/api/factor';

export const factorAnalysisRoute = new Hono();

factorAnalysisRoute.get(
  '/analysis-reports',
  validateQuery(factorReportListQuerySchema),
  async (c) => {
    return c.json(await listFactorReports(c.var.userId, c.req.valid('query')));
  },
);

factorAnalysisRoute.get('/analysis-reports/:reportId', async (c) => {
  return c.json(await readFactorReport(c.var.userId, c.req.param('reportId')));
});

factorAnalysisRoute.get(
  '/analysis-jobs/:jobId',
  validateQuery(factorJobLogsQuerySchema),
  async (c) => {
    return c.json(
      await readFactorAnalysisJob(c.var.userId, c.req.param('jobId'), c.req.valid('query')),
    );
  },
);

factorAnalysisRoute.post('/analyses', validateJson(submitFactorAnalysisSchema), async (c) => {
  return c.json(
    await submitFactorAnalysis(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
  );
});
