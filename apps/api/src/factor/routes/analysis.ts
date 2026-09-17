import { validateJson, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';

import { revealFactorHoldout, submitFactorHoldout } from '../evaluations/holdout.js';
import {
  listFactorReports,
  readFactorAnalysisJob,
  readFactorReport,
  readFactorResearchSummary,
  readFactorResearchWindow,
} from '../evaluations/read.js';
import { submitFactorAnalysis } from '../evaluations/submit.js';
import {
  factorJobLogsQuerySchema,
  factorReportListQuerySchema,
  factorResearchSummaryQuerySchema,
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

factorAnalysisRoute.get('/research/window', async (c) => {
  return c.json(await readFactorResearchWindow());
});

factorAnalysisRoute.get(
  '/research/summary',
  validateQuery(factorResearchSummaryQuerySchema),
  async (c) => {
    return c.json(await readFactorResearchSummary(c.var.userId, c.req.valid('query')));
  },
);

factorAnalysisRoute.post('/analyses', validateJson(submitFactorAnalysisSchema), async (c) => {
  return c.json(
    await submitFactorAnalysis(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
  );
});

factorAnalysisRoute.post('/analysis-reports/:reportId/holdout', async (c) => {
  return c.json(
    await submitFactorHoldout(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
  );
});

factorAnalysisRoute.post('/analysis-reports/:reportId/reveal', async (c) => {
  return c.json(await revealFactorHoldout(c.var.userId, c.req.param('reportId')));
});
