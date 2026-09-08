import { Hono, type MiddlewareHandler } from 'hono';
import { m } from '../infra/http/locale.js';
import { apiError } from '../infra/http/errors.js';
import { getMaintenanceStatus } from './state.js';

export const maintenanceRoute = new Hono();

maintenanceRoute.get('/status', async (context) => context.json(await getMaintenanceStatus()));

export const maintenanceGate: MiddlewareHandler = async (context, next) => {
  const status = await getMaintenanceStatus();
  if (!status.active) {
    await next();
    return;
  }

  context.header('Retry-After', String(status.retryAfterSeconds));
  return apiError(context, 'MAINTENANCE', m(context, 'maintenanceInProgress'), status);
};
