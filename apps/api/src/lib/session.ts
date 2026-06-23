import type { MiddlewareHandler, Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { ulid } from 'ulid';
import { prisma } from './prisma.js';
import { apiError } from './httpError.js';

// === Cookie / Session config ===
//
// COOKIE_NAME: deliberately short — the cookie header is sent on every request, saving a few bytes
// SESSION_TTL_MS: 30 days. Changing this does not affect already-issued sessions (expiresAt is
// already fixed in the DB)
const COOKIE_NAME = 'sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Let every route handler access the current user via c.var.userId / c.var.user.
// Globally extend Hono's ContextVariableMap via module augmentation — the recommended Hono 4 way.
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    user: { id: string; email: string; name: string | null };
  }
}

export interface CreatedSession {
  id: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<CreatedSession> {
  const id = ulid();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  return { id, expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  // deleteMany rather than delete: a missing sid does not throw, so logout is idempotent
  await prisma.session.deleteMany({ where: { id: sessionId } });
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

// Middleware: hard-require an authenticated session. Flow:
//   cookie sid → look up Session (join user) → check not expired + user.status=active → inject ctx
// Any missing step returns 401 so the frontend redirects to login; disabled accounts also get 401.
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const sid = getSessionId(c);
  if (!sid) return apiError(c, 'UNAUTHORIZED', 'login required');

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: {
      user: { select: { id: true, email: true, name: true, status: true } },
    },
  });
  if (!session || session.expiresAt < new Date()) {
    return apiError(c, 'UNAUTHORIZED', 'session expired');
  }
  if (session.user.status !== 'active') {
    return apiError(c, 'UNAUTHORIZED', 'account disabled');
  }

  c.set('userId', session.user.id);
  c.set('user', {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  await next();
};
