import type { MiddlewareHandler } from 'hono';
import { apiError } from '#infra/http/errors.js';
import { resolveSession } from './session.js';
import { getSessionId } from './cookies.js';

// Let every route handler access the current user via c.var.userId / c.var.user.
// Globally extend Hono's ContextVariableMap via module augmentation — the recommended Hono 4 way.
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    user: { id: string; email: string; name: string | null };
  }
}

// Translate session state into the existing HTTP authentication contract.
export const requireAuth: MiddlewareHandler = async (context, next) => {
  const resolution = await resolveSession(getSessionId(context));
  switch (resolution.kind) {
    case 'missing':
      return apiError(context, 'UNAUTHORIZED', 'login required');
    case 'expired':
      return apiError(context, 'UNAUTHORIZED', 'session expired');
    case 'disabled':
      return apiError(context, 'UNAUTHORIZED', 'account disabled');
    case 'ready':
      context.set('userId', resolution.user.id);
      context.set('user', resolution.user);
      await next();
  }
};
