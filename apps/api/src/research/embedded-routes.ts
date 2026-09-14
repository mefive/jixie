import { Hono } from 'hono';
import { apiError, validateJson, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import type { MessageKey } from '#i18n/index.js';
import type { ResearchEmbeddedErrorCodeV1 } from '@jixie/shared';
import { ResearchEmbeddedError } from './embedded/errors.js';
import {
  embeddedCreateSchema,
  embeddedUpdateSchema,
  embeddedDeriveSchema,
  embeddedRunSchema,
  embeddedPageSchema,
  embeddedListSchema,
} from './embedded/contracts.js';
import {
  createEmbeddedAnalysis,
  deriveEmbeddedVersion,
  updateEmbeddedVersion,
} from './embedded/versions.js';
import {
  getEmbeddedAnalysis,
  getEmbeddedVersion,
  listEmbeddedAnalyses,
  listEmbeddedVersions,
  listEmbeddedRuns,
  getEmbeddedRun,
  getEmbeddedInput,
} from './embedded/read.js';
import { submitEmbeddedRun } from './embedded/submit.js';
import { cancelEmbeddedRun } from './embedded/cancel.js';

export const researchEmbeddedRoute = new Hono();
const messageKeys = {
  not_found: 'researchEmbeddedNotFound',
  frozen: 'researchEmbeddedFrozen',
  revision_conflict: 'researchEmbeddedRevisionConflict',
  run_in_progress: 'researchEmbeddedRunInProgress',
  request_conflict: 'researchEmbeddedRequestConflict',
  invalid_report: 'researchEmbeddedInvalidReport',
  input_limit: 'researchEmbeddedInputLimit',
  request_limit: 'researchEmbeddedRequestLimit',
  timeout: 'researchEmbeddedTimeout',
  cancelled: 'researchEmbeddedCancelled',
  interrupted: 'researchEmbeddedInterrupted',
  execution_failed: 'researchEmbeddedExecutionFailed',
} as const satisfies Record<ResearchEmbeddedErrorCodeV1, MessageKey>;

researchEmbeddedRoute.onError((error, c) => {
  if (!(error instanceof ResearchEmbeddedError)) {
    throw error;
  }
  const status =
    error.code === 'not_found'
      ? 'NOT_FOUND'
      : error.code === 'invalid_report'
        ? 'VALIDATION_FAILED'
        : 'CONFLICT';
  return apiError(c, status, m(c, messageKeys[error.code]), { reason: error.code });
});
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
