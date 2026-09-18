import { Hono } from 'hono';
import { getMaintenanceStatus } from './state.js';
import { getDeploymentVersion } from './deployment-version.js';

export const maintenanceRoute = new Hono();

maintenanceRoute.get('/status', async (context) => context.json(await getMaintenanceStatus()));

maintenanceRoute.get('/version', async (context) => {
  context.header('Cache-Control', 'no-store');
  return context.json(await getDeploymentVersion());
});
