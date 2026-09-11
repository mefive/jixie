import { readResearchArtifact } from './evidence/read-artifact.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '#infra/http/errors.js';
import { localeFromRequest, m } from '#infra/http/locale.js';
import {
  getResearchExecution,
  listResearchExecutions,
  promoteResearchExecution,
  ResearchExecutionPromotionUnavailableError,
} from './evidence/execution-records.js';
import {
  createResearchFactorDraft,
  ResearchFactorDraftUnavailableError,
} from './handoff/factor-drafts.js';
import { ResearchFactorHandoffRejectedError } from './handoff/factor-handoff.js';
import {
  createResearchStrategyDraft,
  ResearchStrategyDraftUnavailableError,
} from './handoff/strategy-drafts.js';
import { ResearchStrategyHandoffRejectedError } from './handoff/strategy-handoff.js';

export const researchEvidenceRoute = new Hono();

const promoteExecutionBody = z.strictObject({
  displayName: z.string().trim().min(1).max(160),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  userNote: z.string().trim().max(2_000).optional(),
});

researchEvidenceRoute.get('/artifacts/:artifactId', async (c) => {
  const artifact = await readResearchArtifact(c.var.userId, c.req.param('artifactId'));
  if (!artifact) {
    return apiError(c, 'NOT_FOUND', m(c, 'researchArtifactNotFound'));
  }

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
  return executions ? c.json(executions) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchEvidenceRoute.get('/executions/:executionId', async (c) => {
  const execution = await getResearchExecution(c.var.userId, c.req.param('executionId'));
  return execution
    ? c.json(execution)
    : apiError(c, 'NOT_FOUND', m(c, 'researchExecutionNotFound'));
});

researchEvidenceRoute.post(
  '/executions/:executionId/promote',
  validateJson(promoteExecutionBody),
  async (c) => {
    try {
      const execution = await promoteResearchExecution(
        c.var.userId,
        c.req.param('executionId'),
        c.req.valid('json'),
      );
      return execution
        ? c.json(execution)
        : apiError(c, 'NOT_FOUND', m(c, 'researchExecutionNotFound'));
    } catch (error) {
      if (error instanceof ResearchExecutionPromotionUnavailableError) {
        return apiError(c, 'VALIDATION_FAILED', m(c, 'researchExecutionPromotionUnavailable'));
      }
      throw error;
    }
  },
);

researchEvidenceRoute.post('/executions/:executionId/factor-draft', async (c) => {
  try {
    const draft = await createResearchFactorDraft(
      c.var.userId,
      c.req.param('executionId'),
      localeFromRequest(c),
    );
    return draft ? c.json(draft) : apiError(c, 'NOT_FOUND', m(c, 'researchExecutionNotFound'));
  } catch (error) {
    if (error instanceof ResearchFactorDraftUnavailableError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchFactorDraftUnavailable'));
    }
    if (error instanceof ResearchFactorHandoffRejectedError) {
      return apiError(c, 'VALIDATION_FAILED', error.message);
    }
    throw error;
  }
});

researchEvidenceRoute.post('/executions/:executionId/strategy-draft', async (c) => {
  try {
    const draft = await createResearchStrategyDraft(
      c.var.userId,
      c.req.param('executionId'),
      localeFromRequest(c),
    );
    return draft ? c.json(draft) : apiError(c, 'NOT_FOUND', m(c, 'researchExecutionNotFound'));
  } catch (error) {
    if (error instanceof ResearchStrategyDraftUnavailableError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchStrategyDraftUnavailable'));
    }
    if (error instanceof ResearchStrategyHandoffRejectedError) {
      return apiError(c, 'VALIDATION_FAILED', error.message);
    }
    throw error;
  }
});
