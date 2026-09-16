import {
  documentListQuerySchema,
  createDocumentSchema,
  createCellSchema,
  updateCellSchema,
  renameDocumentSchema,
} from '../schema.js';
import { archiveIdleResearchDocument } from '../documents/archive-idle-document.js';
import { Hono } from 'hono';
import { apiError, validateJson, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import {
  addResearchCell,
  deleteResearchCell,
  updateResearchCell,
} from '../documents/cell-operations.js';
import {
  createResearchDocument,
  restoreResearchDocument,
  renameResearchDocument,
  deleteResearchDocument,
} from '../documents/document-operations.js';
import { createResearchDocumentFromBacktestReport } from '../documents/from-backtest-report.js';
import { getResearchDocument, listResearchDocuments } from '../documents/read.js';
import { ResearchDocumentRunInProgressError } from '../document-runs/run-state.js';
import { ResearchCellChangeReviewOpenError } from '../proposals/review-state.js';
import { ResearchCellRevisionConflictError } from '../documents/revision-errors.js';

export const researchDocumentRoute = new Hono();

researchDocumentRoute.get('/documents', validateQuery(documentListQuerySchema), async (c) =>
  c.json(await listResearchDocuments(c.var.userId, c.req.valid('query').state)),
);

researchDocumentRoute.post('/documents', validateJson(createDocumentSchema), async (c) => {
  const input = c.req.valid('json');
  if ('source' in input) {
    const document = await createResearchDocumentFromBacktestReport(
      c.var.userId,
      input.source.reportId,
    );
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'backtestReportNotFound'));
  }
  return c.json(await createResearchDocument(c.var.userId, input.template));
});

researchDocumentRoute.get('/documents/:documentId', async (c) => {
  const document = await getResearchDocument(c.var.userId, c.req.param('documentId'));
  return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchDocumentRoute.post('/documents/:documentId/archive', async (c) => {
  try {
    const archived = await archiveIdleResearchDocument(c.var.userId, c.req.param('documentId'));
    return archived
      ? c.json({ ok: true as const })
      : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchDocumentRunInProgressError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchDocumentRunInProgress'));
    }
    throw error;
  }
});

researchDocumentRoute.post('/documents/:documentId/restore', async (c) => {
  const restored = await restoreResearchDocument(c.var.userId, c.req.param('documentId'));
  return restored
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchDocumentRoute.post(
  '/documents/:documentId/cells',
  validateJson(createCellSchema),
  async (c) => {
    try {
      const { kind, source } = c.req.valid('json');
      const document = await addResearchCell(c.var.userId, c.req.param('documentId'), kind, source);
      return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
    } catch (error) {
      if (error instanceof ResearchCellChangeReviewOpenError) {
        return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
      }
      throw error;
    }
  },
);

researchDocumentRoute.patch('/cells/:cellId', validateJson(updateCellSchema), async (c) => {
  try {
    const document = await updateResearchCell(
      c.var.userId,
      c.req.param('cellId'),
      c.req.valid('json'),
    );
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellRevisionConflictError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellRevisionConflict'), {
        reason: 'cell_revision_changed',
        currentCell: error.currentCell,
      });
    }
    throw error;
  }
});

researchDocumentRoute.delete('/cells/:cellId', async (c) => {
  try {
    const document = await deleteResearchCell(c.var.userId, c.req.param('cellId'));
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewOpenError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
    }
    throw error;
  }
});

researchDocumentRoute.patch(
  '/documents/:documentId',
  validateJson(renameDocumentSchema),
  async (c) => {
    const updated = await renameResearchDocument(
      c.var.userId,
      c.req.param('documentId'),
      c.req.valid('json').title,
    );
    return updated
      ? c.json({ ok: true as const })
      : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  },
);

researchDocumentRoute.delete('/documents/:documentId', async (c) => {
  const deleted = await deleteResearchDocument(c.var.userId, c.req.param('documentId'));
  return deleted
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});
