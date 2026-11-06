import type { MiddlewareHandler } from 'hono';
import { withMarketAccess, MarketAccessBusyError } from '#infra/coordination/market-access.js';
import { IngestionError } from './errors.js';
import { ingestionPublishingStatus } from './status.js';

/**
 * 发布期间阻止新读取，取消与订阅仍可释放已有任务。
 *
 * Gate new readers during publication while cancellation and subscriptions can release work.
 */
export const ingestionGate: MiddlewareHandler = async (context, next) => {
  if (
    /\/agent\/turns\/[^/]+\/(stream|cancel)$/.test(context.req.path) ||
    /\/runtime\/interrupt$/.test(context.req.path)
  ) {
    await next();
    return;
  }
  try {
    await withMarketAccess(next);
  } catch (error) {
    if (!(error instanceof MarketAccessBusyError)) {
      throw error;
    }

    context.header('Retry-After', String(ingestionPublishingStatus.retryAfterSeconds));
    throw new IngestionError('in_progress', { details: ingestionPublishingStatus });
  }
};
