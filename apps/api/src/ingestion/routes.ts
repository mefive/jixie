import { Hono } from 'hono';
import { getDeploymentVersion } from '#infra/deployment-version.js';
import { getIngestionStatus } from './status.js';

export const ingestionRoute = new Hono();
ingestionRoute.get('/status', async (context) => context.json(await getIngestionStatus()));
ingestionRoute.get('/version', async (context) => {
  context.header('Cache-Control', 'no-store');

  return context.json(await getDeploymentVersion());
});
