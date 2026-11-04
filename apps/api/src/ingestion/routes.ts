import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ingestionIssueListQuerySchema } from '@jixie/shared/api/ingestion';
import { requireAuth } from '#auth/middleware.js';
import { getIngestionIssueList } from './issue-overview.js';
import { getDeploymentVersion } from '#infra/deployment-version.js';
import { getIngestionStatus } from './status.js';

export const ingestionRoute = new Hono();
ingestionRoute.get('/status', async (context) => context.json(await getIngestionStatus()));
ingestionRoute.get('/version', async (context) => {
  context.header('Cache-Control', 'no-store');

  return context.json(await getDeploymentVersion());
});

// 详情需登录；轮询状态只返回计数，不对外暴露 payload、SQL 或内部故障内容。
// Require login for details; polling exposes counts without payloads, SQL or internal failure messages.
ingestionRoute.get(
  '/issues',
  requireAuth,
  zValidator('query', ingestionIssueListQuerySchema),
  async (context) => {
    context.header('Cache-Control', 'no-store');

    return context.json(await getIngestionIssueList(context.req.valid('query')));
  },
);
