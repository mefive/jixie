import type { MiddlewareHandler, Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { apiError } from '../../infra/http/errors.js';
import { resolveSession } from '../session.js';

const COOKIE_NAME = 'sid';

// Let every route handler access the current user via c.var.userId / c.var.user.
// Globally extend Hono's ContextVariableMap via module augmentation — the recommended Hono 4 way.
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    user: { id: string; email: string; name: string | null };
  }
}

export function setSessionCookie(c: Context, sessionId: string, expiresAt: Date): void {
  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    // Force https in production; local http must still work, so switch on NODE_ENV
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export function getSessionId(c: Context): string | undefined {
  return getCookie(c, COOKIE_NAME);
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
