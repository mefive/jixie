import { Hono } from 'hono';
import { getMaintenanceStatus } from './state.js';

export const maintenanceRoute = new Hono();

maintenanceRoute.get('/status', async (context) => context.json(await getMaintenanceStatus()));
