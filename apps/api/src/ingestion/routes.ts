import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  ingestionIssueListQuerySchema,
  ingestionRunParamsSchema,
  acceptIngestionCandidateSchema,
  type IngestionCandidateReview,
  type IngestionCandidatePublication,
} from '@jixie/shared/api/ingestion';
import { requireAuth, requireIngestionPublisher } from '#auth/middleware.js';
import { validateJson } from '#infra/http/errors.js';
import { inspectCandidate, acceptCandidate } from './replica.js';
import { IngestionError } from './errors.js';
import { getIngestionIssueList } from './issue-overview.js';
import { getDeploymentVersion } from '#infra/deployment-version.js';
import { ingestionGate } from './middleware.js';
import { getIngestionStatus } from './status.js';

export const ingestionRoute = new Hono();
ingestionRoute.get('/status', async (context) => {
  context.header('Cache-Control', 'no-store');

  return context.json(await getIngestionStatus());
});
ingestionRoute.get('/version', async (context) => {
  context.header('Cache-Control', 'no-store');

  return context.json(await getDeploymentVersion());
});

// 详情需登录；轮询状态只返回计数，不对外暴露 payload、SQL 或内部故障内容。
// Require login for details; polling exposes counts without payloads, SQL or internal failure messages.
ingestionRoute.get(
  '/issues',
  ingestionGate,
  requireAuth,
  zValidator('query', ingestionIssueListQuerySchema),
  async (context) => {
    context.header('Cache-Control', 'no-store');

    return context.json(await getIngestionIssueList(context.req.valid('query')));
  },
);

/**
 * 发布路由位于业务读取门禁之外，由既有发布锁排空读者。
 *
 * Keep publication outside the business reader gate so the existing publication lock can drain readers.
 */
ingestionRoute.get(
  '/runs/:runId',
  requireAuth,
  requireIngestionPublisher,
  zValidator('param', ingestionRunParamsSchema),
  async (context) => {
    context.header('Cache-Control', 'no-store');
    const candidate = await inspectCandidate(context.req.valid('param').runId);
    if (
      !candidate.candidateVersion ||
      typeof candidate.pending !== 'number' ||
      candidate.finishedAt === undefined ||
      candidate.execution === undefined
    ) {
      throw new IngestionError('candidate_state_conflict');
    }
    const response: IngestionCandidateReview = {
      runId: candidate.runId,
      targetDate: candidate.targetDate,
      phase: candidate.phase,
      status: candidate.status,
      pending: candidate.pending,
      candidateVersion: candidate.candidateVersion,
      finishedAt: candidate.finishedAt,
      execution: candidate.execution,
    };

    return context.json(response);
  },
);

ingestionRoute.post(
  '/runs/:runId/accept',
  requireAuth,
  requireIngestionPublisher,
  zValidator('param', ingestionRunParamsSchema),
  validateJson(acceptIngestionCandidateSchema),
  async (context) => {
    context.header('Cache-Control', 'no-store');
    const { runId } = context.req.valid('param');
    const { expectedCandidateVersion } = context.req.valid('json');
    const published = await acceptCandidate(runId, expectedCandidateVersion);
    if (published.revision === null) {
      throw new IngestionError('candidate_state_conflict');
    }
    const response: IngestionCandidatePublication = {
      mode: published.mode,
      runId: published.runId,
      revision: published.revision,
    };

    return context.json(response);
  },
);
