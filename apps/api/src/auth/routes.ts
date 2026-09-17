import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import { clearSessionCookie, getSessionId, setSessionCookie } from './cookies.js';
import { developmentLogin } from './development-login.js';
import { requestEmailLogin, verifyEmailLogin } from './email-login.js';
import {
  developmentLoginSchema,
  emailLoginRequestSchema,
  emailLoginVerifySchema,
} from './schema.js';
import { destroySession, getSessionUser } from './session.js';

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
  return context.json(result);
});

authRoute.post('/email/verify', validateJson(emailLoginVerifySchema), async (context) => {
  const result = await verifyEmailLogin(context.req.valid('json'));
  setSessionCookie(context, result.session.id, result.session.expiresAt);
  return context.json({ user: result.user });
});

// Production never registers this development-only route.
if (process.env.NODE_ENV !== 'production') {
  authRoute.post('/dev/login', validateJson(developmentLoginSchema), async (context) => {
    const result = await developmentLogin(context.req.valid('json').email);
    setSessionCookie(context, result.session.id, result.session.expiresAt);
    return context.json({ user: result.user });
  });
}
