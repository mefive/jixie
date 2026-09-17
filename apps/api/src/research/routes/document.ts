import { validateJson, validateQuery } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { archiveIdleResearchDocument } from '../documents/archive-idle-document.js';
import {
  addResearchCell,
  deleteResearchCell,
  updateResearchCell,
} from '../documents/cell-operations.js';
import {
  createResearchDocument,
  deleteResearchDocument,
  renameResearchDocument,
  restoreResearchDocument,
} from '../documents/document-operations.js';
import { createResearchDocumentFromBacktestReport } from '../documents/from-backtest-report.js';
import { getResearchDocument, listResearchDocuments } from '../documents/read.js';
import {
  createCellSchema,
  createDocumentSchema,
  documentListQuerySchema,
  renameDocumentSchema,
  updateCellSchema,
} from '@jixie/shared/api/research';

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
    return c.json(document);
  }
  return c.json(await createResearchDocument(c.var.userId, input.template));
});

researchDocumentRoute.get('/documents/:documentId', async (c) => {
  const document = await getResearchDocument(c.var.userId, c.req.param('documentId'));
  return c.json(document);
});

researchDocumentRoute.post('/documents/:documentId/archive', async (c) => {
  await archiveIdleResearchDocument(c.var.userId, c.req.param('documentId'));
  return c.json({ ok: true as const });
});

researchDocumentRoute.post('/documents/:documentId/restore', async (c) => {
  await restoreResearchDocument(c.var.userId, c.req.param('documentId'));
  return c.json({ ok: true as const });
});

researchDocumentRoute.post(
  '/documents/:documentId/cells',
  validateJson(createCellSchema),
  async (c) => {
    const { kind, source } = c.req.valid('json');
    const document = await addResearchCell(c.var.userId, c.req.param('documentId'), kind, source);
    return c.json(document);
  },
);

researchDocumentRoute.patch('/cells/:cellId', validateJson(updateCellSchema), async (c) => {
  const document = await updateResearchCell(
    c.var.userId,
    c.req.param('cellId'),
    c.req.valid('json'),
  );
  return c.json(document);
});

researchDocumentRoute.delete('/cells/:cellId', async (c) => {
  const document = await deleteResearchCell(c.var.userId, c.req.param('cellId'));
  return c.json(document);
});

researchDocumentRoute.patch(
  '/documents/:documentId',
  validateJson(renameDocumentSchema),
  async (c) => {
    await renameResearchDocument(
      c.var.userId,
      c.req.param('documentId'),
      c.req.valid('json').title,
    );
    return c.json({ ok: true as const });
  },
);

researchDocumentRoute.delete('/documents/:documentId', async (c) => {
  await deleteResearchDocument(c.var.userId, c.req.param('documentId'));
  return c.json({ ok: true as const });
});
