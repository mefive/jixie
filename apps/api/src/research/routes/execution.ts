import { runDocumentSchema } from '@jixie/shared/api/research';

import { validateJson } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { analyzeResearchDocument } from '../dependencies/analyze.js';
import {
  interruptResearchDocument,
  resetResearchDocumentRuntime,
} from '../document-runs/control.js';

import { runAffectedResearchCells } from '../document-runs/run-affected.js';
import { runResearchCell } from '../document-runs/run-cell.js';
import { runResearchDocument } from '../document-runs/run-document.js';

export const researchExecutionRoute = new Hono();

researchExecutionRoute.post('/cells/:cellId/run', async (c) => {
  const document = await runResearchCell(c.var.userId, c.req.param('cellId'));
  return c.json(document);
});

researchExecutionRoute.post('/cells/:cellId/run-affected', async (c) => {
  const result = await runAffectedResearchCells(c.var.userId, c.req.param('cellId'));
  return c.json(result);
});

researchExecutionRoute.post('/documents/:documentId/dependency-analysis', async (c) => {
  const result = await analyzeResearchDocument(c.var.userId, c.req.param('documentId'));
  return c.json(result);
});

researchExecutionRoute.post(
  '/documents/:documentId/run',
  validateJson(runDocumentSchema),
  async (c) => {
    const result = await runResearchDocument(
      c.var.userId,
      c.req.param('documentId'),
      c.req.valid('json').clean,
    );
    return c.json(result);
  },
);

researchExecutionRoute.post('/documents/:documentId/runtime/interrupt', async (c) => {
  const result = await interruptResearchDocument(c.var.userId, c.req.param('documentId'));
  return c.json(result);
});

researchExecutionRoute.post('/documents/:documentId/runtime/reset', async (c) => {
  const document = await resetResearchDocumentRuntime(c.var.userId, c.req.param('documentId'));
  return c.json(document);
});
