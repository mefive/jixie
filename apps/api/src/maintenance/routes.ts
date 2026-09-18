import { Hono } from 'hono';
import { getDeploymentVersion } from './publication/deployment-version.js';
import { getMaintenanceStatus } from './runs/state.js';

export const maintenanceRoute = new Hono();

maintenanceRoute.get('/status', async (context) => context.json(await getMaintenanceStatus()));

maintenanceRoute.get('/version', async (context) => {
  context.header('Cache-Control', 'no-store');
  return context.json(await getDeploymentVersion());
});
