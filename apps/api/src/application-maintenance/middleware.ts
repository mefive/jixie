import type { MiddlewareHandler } from 'hono';
import { MaintenanceError } from './errors.js';
import { getMaintenanceStatus } from './state.js';

export const maintenanceGate: MiddlewareHandler = async (context, next) => {
  const status = await getMaintenanceStatus();
  if (!status.active) {
    await next();
    return;
  }

  context.header('Retry-After', String(status.retryAfterSeconds));
  throw new MaintenanceError('in_progress', { details: status });
};
