import { researchExecutionError } from './route-errors.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { analyzeResearchDocument } from './dependencies/analyze.js';
import { interruptResearchDocument, resetResearchDocumentRuntime } from './execution/control.js';
import { ResearchAffectedRunError } from './dependencies/run-plan.js';
import { ResearchCellChangeReviewOpenError } from './proposals/review-state.js';
import { runAffectedResearchCells } from './execution/run-affected.js';
import { runResearchCell } from './execution/run-cell.js';
import { runResearchDocument } from './execution/run-document.js';

export const researchExecutionRoute = new Hono();

const runDocumentBody = z.strictObject({ clean: z.boolean().default(true) });

researchExecutionRoute.post('/cells/:cellId/run', async (c) => {
  try {
    const document = await runResearchCell(c.var.userId, c.req.param('cellId'));
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    const response = researchExecutionError(c, error);
    if (response) {
      return response;
    }
    throw error;
  }
});

researchExecutionRoute.post('/cells/:cellId/run-affected', async (c) => {
  try {
    const result = await runAffectedResearchCells(c.var.userId, c.req.param('cellId'));
    return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    const response = researchExecutionError(c, error);
    if (response) {
      return response;
    }
    if (error instanceof ResearchAffectedRunError) {
      const messageKey =
        error.reason === 'duplicate_definitions'
          ? 'researchAffectedRunDuplicateDefinitions'
          : 'researchAffectedRunCyclicDependency';
      return apiError(c, 'VALIDATION_FAILED', m(c, messageKey), {
        reason: error.reason,
        ...(error.reason === 'duplicate_definitions'
          ? { conflicts: error.details }
          : { cellIds: error.details }),
      });
    }
    throw error;
  }
});

researchExecutionRoute.post('/documents/:documentId/dependency-analysis', async (c) => {
  const result = await analyzeResearchDocument(c.var.userId, c.req.param('documentId'));
  return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchExecutionRoute.post(
  '/documents/:documentId/run',
  validateJson(runDocumentBody),
  async (c) => {
    try {
      const result = await runResearchDocument(
        c.var.userId,
        c.req.param('documentId'),
        c.req.valid('json').clean,
      );
      return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
    } catch (error) {
      const response = researchExecutionError(c, error);
      if (response) {
        return response;
      }
      throw error;
    }
  },
);

researchExecutionRoute.post('/documents/:documentId/runtime/interrupt', async (c) => {
  const result = await interruptResearchDocument(c.var.userId, c.req.param('documentId'));
  return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchExecutionRoute.post('/documents/:documentId/runtime/reset', async (c) => {
  try {
    const document = await resetResearchDocumentRuntime(c.var.userId, c.req.param('documentId'));
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewOpenError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
    }
    throw error;
  }
});
