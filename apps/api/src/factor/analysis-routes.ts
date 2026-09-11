import { Hono } from 'hono';
import { validateJson, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { factorOperationApiError } from './route-errors.js';
import { factorJobLogsQuerySchema } from './analysis/job-queries.js';
import {
  factorReportListQuerySchema,
  listFactorReports,
  readFactorReport,
  readFactorAnalysisJob,
  factorResearchSummaryQuerySchema,
  readFactorResearchWindow,
  readFactorResearchSummary,
} from './reports/read.js';
import { submitFactorAnalysisSchema, submitFactorAnalysis } from './analysis/submit.js';
import { submitFactorHoldout, revealFactorHoldout } from './reports/holdout.js';

export const factorAnalysisRoute = new Hono();

factorAnalysisRoute.get(
  '/analysis-reports',
  validateQuery(factorReportListQuerySchema),
  async (c) => {
    try {
      return c.json(await listFactorReports(c.var.userId, c.req.valid('query')));
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);

factorAnalysisRoute.get('/analysis-reports/:reportId', async (c) => {
  try {
    return c.json(
      await readFactorReport(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorAnalysisRoute.get(
  '/analysis-jobs/:jobId',
  validateQuery(factorJobLogsQuerySchema),
  async (c) => {
    try {
      return c.json(
        await readFactorAnalysisJob(
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

factorAnalysisRoute.get('/research/window', async (c) => {
  try {
    return c.json(await readFactorResearchWindow(localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorAnalysisRoute.get(
  '/research/summary',
  validateQuery(factorResearchSummaryQuerySchema),
  async (c) => {
    try {
      return c.json(await readFactorResearchSummary(c.var.userId, c.req.valid('query')));
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);

factorAnalysisRoute.post('/analyses', validateJson(submitFactorAnalysisSchema), async (c) => {
  try {
    return c.json(
      await submitFactorAnalysis(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorAnalysisRoute.post('/analysis-reports/:reportId/holdout', async (c) => {
  try {
    return c.json(
      await submitFactorHoldout(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorAnalysisRoute.post('/analysis-reports/:reportId/reveal', async (c) => {
  try {
    return c.json(
      await revealFactorHoldout(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});
