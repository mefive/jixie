import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import {
  getResearchExecution,
  listResearchExecutions,
  promoteResearchExecution,
} from '../evidence/execution-records.js';
import { readResearchArtifact } from '../evidence/read-artifact.js';
import { createResearchFactorDraft } from '../handoff/factor-drafts.js';
import { promoteExecutionSchema } from '../schema.js';

import { createResearchStrategyDraft } from '../handoff/strategy-drafts.js';

export const researchEvidenceRoute = new Hono();

researchEvidenceRoute.get('/artifacts/:artifactId', async (c) => {
  const artifact = await readResearchArtifact(c.var.userId, c.req.param('artifactId'));

  const etag = `"${artifact.sha256}"`;
  // Revalidate ownership before reuse because one browser profile can switch accounts.
  c.header('Cache-Control', 'private, no-cache');
  c.header('ETag', etag);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "sandbox; default-src 'none'");
  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304);
  }
  c.header('Content-Type', artifact.mimeType);
  c.header('Content-Length', String(artifact.byteSize));
  return c.body(new Uint8Array(artifact.data));
});

researchEvidenceRoute.get('/documents/:documentId/executions', async (c) => {
  const executions = await listResearchExecutions(c.var.userId, c.req.param('documentId'));
  return c.json(executions);
});

researchEvidenceRoute.get('/executions/:executionId', async (c) => {
  const execution = await getResearchExecution(c.var.userId, c.req.param('executionId'));
  return c.json(execution);
});

researchEvidenceRoute.post(
  '/executions/:executionId/promote',
  validateJson(promoteExecutionSchema),
  async (c) => {
    const execution = await promoteResearchExecution(
      c.var.userId,
      c.req.param('executionId'),
      c.req.valid('json'),
    );
    return c.json(execution);
  },
);

researchEvidenceRoute.post('/executions/:executionId/factor-draft', async (c) => {
  const draft = await createResearchFactorDraft(
    c.var.userId,
    c.req.param('executionId'),
    localeFromRequest(c),
  );
  return c.json(draft);
});

researchEvidenceRoute.post('/executions/:executionId/strategy-draft', async (c) => {
  const draft = await createResearchStrategyDraft(
    c.var.userId,
    c.req.param('executionId'),
    localeFromRequest(c),
  );
  return c.json(draft);
});
