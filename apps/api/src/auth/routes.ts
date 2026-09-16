import {
  emailLoginRequestSchema,
  emailLoginVerifySchema,
  developmentLoginSchema,
} from './schema.js';
import { Hono } from 'hono';
import { apiError, validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { destroySession, getSessionUser } from './session.js';
import { requestEmailLogin, verifyEmailLogin } from './email-login.js';
import { developmentLogin } from './development-login.js';
import { clearSessionCookie, getSessionId, setSessionCookie } from './cookies.js';

export const authRoute = new Hono();

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

authRoute.post('/email/request', validateJson(emailLoginRequestSchema), async (context) => {
  const result = await requestEmailLogin(context.req.valid('json'), localeFromRequest(context));
  if ('error' in result) {
    return apiError(context, result.error.code, result.error.message, result.error.details);
  }
  return context.json(result);
});

authRoute.post('/email/verify', validateJson(emailLoginVerifySchema), async (context) => {
  const result = await verifyEmailLogin(context.req.valid('json'), localeFromRequest(context));
  if ('error' in result) {
    return apiError(context, result.error.code, result.error.message, result.error.details);
  }
  setSessionCookie(context, result.session.id, result.session.expiresAt);
  return context.json({ user: result.user });
});

// Production never registers this development-only route.
if (process.env.NODE_ENV !== 'production') {
  authRoute.post('/dev/login', validateJson(developmentLoginSchema), async (context) => {
    const result = await developmentLogin(context.req.valid('json').email);
    if ('error' in result) {
      return apiError(context, result.error.code, result.error.message, result.error.details);
    }
    setSessionCookie(context, result.session.id, result.session.expiresAt);
    return context.json({ user: result.user });
  });
}
