import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const COOKIE_NAME = 'sid';

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
