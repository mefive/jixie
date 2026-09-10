import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { normalizeInviteCode } from '../invite-code.js';
import { destroySession, getSessionUser } from '../session.js';
import { requestEmailLogin, verifyEmailLogin } from '../email-login.js';
import { developmentLogin } from '../development-login.js';
import { clearSessionCookie, getSessionId, setSessionCookie } from './session.js';

export const authRoute = new Hono();

const emailField = z
  .string()
  .trim()
  .email()
  .transform((s) => s.toLowerCase());

authRoute.get('/me', async (context) => {
  return context.json({ user: await getSessionUser(getSessionId(context)) });
});

authRoute.post('/logout', async (context) => {
  const sessionId = getSessionId(context);
  if (sessionId) {
    await destroySession(sessionId);
  }
  clearSessionCookie(context);
  return context.json({ ok: true });
});

const emailRequestBody = z.object({
  email: emailField,
  inviteCode: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? normalizeInviteCode(v) : undefined)),
});

authRoute.post('/email/request', validateJson(emailRequestBody), async (context) => {
  const result = await requestEmailLogin(context.req.valid('json'), localeFromRequest(context));
  if ('error' in result) {
    return apiError(context, result.error.code, result.error.message, result.error.details);
  }
  return context.json(result);
});

const emailVerifyBody = z.object({
  challengeId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'code must be 6 digits'),
});

authRoute.post('/email/verify', validateJson(emailVerifyBody), async (context) => {
  const result = await verifyEmailLogin(context.req.valid('json'), localeFromRequest(context));
  if ('error' in result) {
    return apiError(context, result.error.code, result.error.message, result.error.details);
  }
  setSessionCookie(context, result.session.id, result.session.expiresAt);
  return context.json({ user: result.user });
});

const devLoginBody = z.object({ email: emailField });

// Production never registers this development-only route.
if (process.env.NODE_ENV !== 'production') {
  authRoute.post('/dev/login', validateJson(devLoginBody), async (context) => {
    const result = await developmentLogin(context.req.valid('json').email);
    if ('error' in result) {
      return apiError(context, result.error.code, result.error.message, result.error.details);
    }
    setSessionCookie(context, result.session.id, result.session.expiresAt);
    return context.json({ user: result.user });
  });
}
