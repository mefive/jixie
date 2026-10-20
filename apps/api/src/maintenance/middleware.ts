import { withMarketAccess, MarketAccessBusyError } from '#infra/coordination/market-access.js';
import type { MiddlewareHandler } from 'hono';
import { MaintenanceError } from './errors.js';
import { getMaintenanceStatus } from './runs/state.js';

export const maintenanceGate: MiddlewareHandler = async (context, next) => {
  // 订阅和取消不读取市场快照，发布等待期间仍允许释放在途任务。
  // Subscriptions and cancellation must remain available while publication drains work.
  const path = context.req.path;
  if (/\/agent\/turns\/[^/]+\/(stream|cancel)$/.test(path) || /\/runtime\/interrupt$/.test(path)) {
    await next();
    return;
  }
  const status = await getMaintenanceStatus();
  if (!status.active) {
    try {
      await withMarketAccess(next);
      return;
    } catch (error) {
      if (!(error instanceof MarketAccessBusyError)) {
        throw error;
      }
      context.header('Retry-After', '5');
      throw new MaintenanceError('in_progress', { details: await getMaintenanceStatus() });
    }
  }

  context.header('Retry-After', String(status.retryAfterSeconds));
  throw new MaintenanceError('in_progress', { details: status });
};
