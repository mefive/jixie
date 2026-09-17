import { validateJson, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import {
  embeddedCreateSchema,
  embeddedDeriveSchema,
  embeddedInputModeSchema,
  embeddedListSchema,
  embeddedPageSchema,
  embeddedRunSchema,
  embeddedUpdateSchema,
} from '../schema.js';

import { cancelEmbeddedRun } from '../embedded/cancel.js';
import { changeEmbeddedInputMode, continueEmbeddedResearch } from '../embedded/continuation.js';
import {
  getEmbeddedAnalysis,
  getEmbeddedInput,
  getEmbeddedRun,
  getEmbeddedVersion,
  listEmbeddedAnalyses,
  listEmbeddedRuns,
  listEmbeddedVersions,
} from '../embedded/read.js';
import { submitEmbeddedRun } from '../embedded/submit.js';
import {
  createEmbeddedAnalysis,
  deriveEmbeddedVersion,
  updateEmbeddedVersion,
} from '../embedded/versions.js';

export const researchEmbeddedRoute = new Hono();

researchEmbeddedRoute.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});

researchEmbeddedRoute.post('/', validateJson(embeddedCreateSchema), async (c) =>
  c.json(await createEmbeddedAnalysis(c.var.userId, c.req.valid('json')), 201),
);
researchEmbeddedRoute.get('/', validateQuery(embeddedListSchema), async (c) =>
  c.json(await listEmbeddedAnalyses(c.var.userId, c.req.valid('query'))),
);
researchEmbeddedRoute.get('/:analysisId', async (c) =>
  c.json(await getEmbeddedAnalysis(c.var.userId, c.req.param('analysisId'))),
);
researchEmbeddedRoute.get('/:analysisId/versions', validateQuery(embeddedPageSchema), async (c) =>
  c.json(await listEmbeddedVersions(c.var.userId, c.req.param('analysisId'), c.req.valid('query'))),
);
researchEmbeddedRoute.post('/:analysisId/versions', validateJson(embeddedDeriveSchema), async (c) =>
  c.json(
    await deriveEmbeddedVersion(c.var.userId, c.req.param('analysisId'), c.req.valid('json')),
    201,
  ),
);
researchEmbeddedRoute.get('/:analysisId/versions/:versionId', async (c) =>
  c.json(
    await getEmbeddedVersion(c.var.userId, c.req.param('analysisId'), c.req.param('versionId')),
  ),
);
researchEmbeddedRoute.patch(
  '/:analysisId/versions/:versionId',
  validateJson(embeddedUpdateSchema),
  async (c) =>
    c.json(
      await updateEmbeddedVersion(
        c.var.userId,
        c.req.param('analysisId'),
        c.req.param('versionId'),
        c.req.valid('json'),
      ),
    ),
);
researchEmbeddedRoute.post(
  '/:analysisId/versions/:versionId/runs',
  validateJson(embeddedRunSchema),
  async (c) =>
    c.json(
      await submitEmbeddedRun(
        c.var.userId,
        c.req.param('analysisId'),
        c.req.param('versionId'),
        c.req.valid('json'),
      ),
      202,
    ),
);
researchEmbeddedRoute.get('/:analysisId/runs', validateQuery(embeddedPageSchema), async (c) =>
  c.json(await listEmbeddedRuns(c.var.userId, c.req.param('analysisId'), c.req.valid('query'))),
);
researchEmbeddedRoute.get('/:analysisId/runs/:runId', async (c) =>
  c.json(await getEmbeddedRun(c.var.userId, c.req.param('analysisId'), c.req.param('runId'))),
);
researchEmbeddedRoute.post('/:analysisId/runs/:runId/continue-research', async (c) =>
  c.json(
    await continueEmbeddedResearch(
      c.var.userId,
      c.req.param('analysisId'),
      c.req.param('runId'),
      localeFromRequest(c),
    ),
  ),
);
researchEmbeddedRoute.patch(
  '/documents/:documentId/input-mode',
  validateJson(embeddedInputModeSchema),
  async (c) =>
    c.json(
      await changeEmbeddedInputMode(c.var.userId, c.req.param('documentId'), c.req.valid('json')),
    ),
);
researchEmbeddedRoute.post('/:analysisId/runs/:runId/cancel', async (c) =>
  c.json(await cancelEmbeddedRun(c.var.userId, c.req.param('analysisId'), c.req.param('runId'))),
);
researchEmbeddedRoute.get('/:analysisId/runs/:runId/inputs/:inputId', async (c) =>
  c.json(
    await getEmbeddedInput(
      c.var.userId,
      c.req.param('analysisId'),
      c.req.param('runId'),
      c.req.param('inputId'),
    ),
  ),
);
