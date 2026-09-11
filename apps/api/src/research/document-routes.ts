import { archiveIdleResearchDocument } from './documents/archive-idle-document.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import {
  addResearchCell,
  deleteResearchCell,
  updateResearchCell,
} from './documents/cell-operations.js';
import {
  createResearchDocument,
  listResearchDocuments,
  restoreResearchDocument,
  renameResearchDocument,
  deleteResearchDocument,
} from './documents/document-operations.js';
import { createResearchDocumentFromBacktestReport } from './documents/from-backtest-report.js';
import { getResearchDocument } from './documents/read.js';
import { ResearchDocumentRunInProgressError } from './execution/run-state.js';
import { ResearchCellChangeReviewOpenError } from './proposals/review-state.js';
import { ResearchCellRevisionConflictError } from './documents/revision-errors.js';

export const researchDocumentRoute = new Hono();

const documentListQuery = z.strictObject({
  state: z.enum(['active', 'archived']).default('active'),
});

const createDocumentBody = z.union([
  z.strictObject({
    template: z.enum(['blank', 'index_relationship', 'equity_fcff_valuation']).default('blank'),
  }),
  z.strictObject({
    source: z.strictObject({
      type: z.literal('backtest-report'),
      reportId: z.string().trim().min(1),
    }),
  }),
]);

const createCellBody = z.strictObject({
  kind: z.enum(['markdown', 'python']),
  source: z.string().max(100_000).default(''),
});

const updateCellBody = z
  .strictObject({
    source: z.string().max(100_000).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    expectedRevision: z.number().int().positive(),
  })
  .refine((value) => value.source !== undefined || value.config !== undefined);

const renameBody = z.strictObject({ title: z.string().trim().min(1).max(120) });

researchDocumentRoute.get('/documents', validateQuery(documentListQuery), async (c) =>
  c.json(await listResearchDocuments(c.var.userId, c.req.valid('query').state)),
);

researchDocumentRoute.post('/documents', validateJson(createDocumentBody), async (c) => {
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
  validateJson(createCellBody),
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

researchDocumentRoute.patch('/cells/:cellId', validateJson(updateCellBody), async (c) => {
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

researchDocumentRoute.patch('/documents/:documentId', validateJson(renameBody), async (c) => {
  const updated = await renameResearchDocument(
    c.var.userId,
    c.req.param('documentId'),
    c.req.valid('json').title,
  );
  return updated
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchDocumentRoute.delete('/documents/:documentId', async (c) => {
  const deleted = await deleteResearchDocument(c.var.userId, c.req.param('documentId'));
  return deleted
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});
