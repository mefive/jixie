import { Hono } from 'hono';
import { validateJson, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import {
  factorAgentInputSchema,
  startFactorAgentTurn,
  presetFactorQuestionSchema,
  startPresetFactorQuestion,
} from './agent-turn.js';
import {
  factorMetadataInputSchema,
  refreshOwnedFactorMetadata,
} from './definitions/metadata-operations.js';
import {
  factorJobLogsQuerySchema,
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
import {
  factorCorrelationQuerySchema,
  readFactorCorrelation,
  findFactorCorrelationJob,
  submitFactorCorrelation,
} from './analysis/correlation-operations.js';
import { factorOperationApiError } from './route-errors.js';

export const factorRoute = new Hono();

factorRoute.post('/agent', validateJson(factorAgentInputSchema), async (c) => {
  try {
    return c.json(
      await startFactorAgentTurn(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.post('/qa', validateJson(presetFactorQuestionSchema), (c) => {
  try {
    return c.json(
      startPresetFactorQuestion(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.post('/metadata', validateJson(factorMetadataInputSchema), async (c) => {
  try {
    return c.json(
      await refreshOwnedFactorMetadata(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.get('/reports', validateQuery(factorReportListQuerySchema), async (c) => {
  try {
    return c.json(await listFactorReports(c.var.userId, c.req.valid('query')));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.get('/reports/:reportId', async (c) => {
  try {
    return c.json(
      await readFactorReport(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.get('/analysis/job/:jobId', validateQuery(factorJobLogsQuerySchema), async (c) => {
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
});

factorRoute.get('/research/window', async (c) => {
  try {
    return c.json(await readFactorResearchWindow(localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.get('/research/summary', validateQuery(factorResearchSummaryQuerySchema), async (c) => {
  try {
    return c.json(await readFactorResearchSummary(c.var.userId, c.req.valid('query')));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.post('/analysis/run', validateJson(submitFactorAnalysisSchema), async (c) => {
  try {
    return c.json(
      await submitFactorAnalysis(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.post('/reports/:reportId/holdout', async (c) => {
  try {
    return c.json(
      await submitFactorHoldout(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.post('/reports/:reportId/reveal', async (c) => {
  try {
    return c.json(
      await revealFactorHoldout(c.var.userId, c.req.param('reportId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.get('/correlation', validateQuery(factorCorrelationQuerySchema), async (c) => {
  try {
    return c.json(
      await readFactorCorrelation(c.var.userId, c.req.valid('query'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.get('/correlation/running', validateQuery(factorCorrelationQuerySchema), async (c) => {
  try {
    return c.json(await findFactorCorrelationJob(c.var.userId, c.req.valid('query')));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorRoute.post('/correlation/run', validateQuery(factorCorrelationQuerySchema), async (c) => {
  try {
    return c.json(
      await submitFactorCorrelation(c.var.userId, c.req.valid('query'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});
