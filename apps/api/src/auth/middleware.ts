import type { MiddlewareHandler } from 'hono';
import { getSessionId } from './cookies.js';
import { AuthError } from './errors.js';
import { resolveSession } from './session.js';

// Let every route handler access the current user via c.var.userId / c.var.user.
// Globally extend Hono's ContextVariableMap via module augmentation — the recommended Hono 4 way.
declare module 'hono' {
  /**
   * 扩展 HTTP 上下文中的已认证用户信息，供后续路由使用。
   * Declare authenticated user context shared by HTTP middleware and routes.
   */
  interface ContextVariableMap {
    userId: string;
    user: { id: string; email: string; name: string | null };
  }
}

// Translate session state into the existing HTTP authentication contract.

/**
 * 解析请求会话并注入用户上下文，未认证时阻止受保护路由执行。
 * Resolve the request session and populate user context before protected routes run.
 */
export const requireAuth: MiddlewareHandler = async (context, next) => {
  const resolution = await resolveSession(getSessionId(context));
  switch (resolution.kind) {
    case 'missing':
      throw new AuthError('login_required');
    case 'expired':
      throw new AuthError('session_expired');
    case 'disabled':
      throw new AuthError('session_disabled');
    case 'ready':
      context.set('userId', resolution.user.id);
      context.set('user', resolution.user);
      await next();
  }
};
