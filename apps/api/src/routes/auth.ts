import { createHash, randomInt } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { apiError, validateJson } from '../lib/httpError.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionId,
  setSessionCookie,
} from '../lib/session.js';
import { buildVerificationEmail, isEmailConfigured, sendEmail } from '../lib/email.js';
import { isValidInviteCodeFormat, normalizeInviteCode } from '../lib/inviteCode.js';
import { localeFromRequest, m } from '../i18n/index.js';

export const authRoute = new Hono();

// Email normalization: trim + lowercase. All writes/reads use this form, avoiding two accounts
// arising from case differences.
const emailField = z
  .string()
  .trim()
  .email()
  .transform((s) => s.toLowerCase());

// === GET /api/auth/me ===
//
// Returns the current logged-in user. **Deliberately does not force 401**: returns { user: null }
// when not logged in, { user } when logged in.
// The frontend calls /me once at startup to decide whether to go to the login page or the home
// page, without having to hit a 401 first and then recover.
authRoute.get('/me', async (c) => {
  const sid = getSessionId(c);
  if (!sid) {
    return c.json({ user: null });
  }

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: { select: { id: true, email: true, name: true, status: true } } },
  });
  if (!session || session.expiresAt < new Date() || session.user.status !== 'active') {
    return c.json({ user: null });
  }
  return c.json({
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
  });
});

// === POST /api/auth/logout ===
//
// Delete the Session row + clear the cookie. Idempotent: calling it while logged out also returns
// ok.
authRoute.post('/logout', async (c) => {
  const sid = getSessionId(c);
  if (sid) {
    await destroySession(sid);
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// === POST /api/auth/email/request ===
//
// Two-factor step one: email (+ invite code, registration only) → server generates a 6-digit code
// → sends an email → returns challengeId to the frontend, which calls /verify with challengeId +
// code in step two.
//
// Register vs login is distinguished by "whether the email already exists in the User table": a
// registered email may not pass an invite code; an unregistered one must pass a valid, unconsumed
// invite code.
const emailRequestBody = z.object({
  email: emailField,
  inviteCode: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? normalizeInviteCode(v) : undefined)),
});

const VERIFICATION_CODE_TTL_MS = 10 * 60_000; // 10 minutes
const RESEND_THROTTLE_MS = 60_000; // same email cannot resend within 60 seconds

authRoute.post('/email/request', validateJson(emailRequestBody), async (c) => {
  const { email, inviteCode } = c.req.valid('json');

  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    // login case
    if (inviteCode) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'emailAlreadyRegistered'), {
        field: 'inviteCode',
      });
    }
    if (existingUser.status !== 'active') {
      return apiError(c, 'FORBIDDEN', m(c, 'accountDisabled'));
    }
  } else {
    // registration case
    if (!inviteCode) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'inviteCodeRequired'), { field: 'inviteCode' });
    }
    if (!isValidInviteCodeFormat(inviteCode)) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'inviteCodeInvalidFormat'), {
        field: 'inviteCode',
      });
    }
    const code = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
    if (!code || code.status !== 'unused') {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'inviteCodeInvalidOrUsed'), {
        field: 'inviteCode',
      });
    }
  }

  // Rate limit: refuse to resend if an unconsumed, unexpired challenge exists within 60s
  const recent = await prisma.emailLoginChallenge.findFirst({
    where: {
      email,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      createdAt: { gt: new Date(Date.now() - RESEND_THROTTLE_MS) },
    },
    select: { id: true },
  });
  if (recent) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'codeAlreadySent'));
  }

  // Generate a 6-digit numeric code. randomInt is cryptographically secure; 100000~999999 = 900k
  // possibilities.
  const verificationCode = String(randomInt(100_000, 1_000_000));
  const challengeId = ulid();
  const codeHash = createHash('sha256').update(verificationCode).digest('hex');
  const now = new Date();

  await prisma.emailLoginChallenge.create({
    data: {
      id: challengeId,
      email,
      // Only record the invite code for registration (re-validated and consumed at verify); null
      // for login
      inviteCode: existingUser ? null : inviteCode,
      codeHash,
      expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
    },
  });

  // dev fallback: Resend not configured and non-production → print the code to the console instead
  // of really sending email, for easy local self-testing.
  if (!isEmailConfigured() && process.env.NODE_ENV !== 'production') {
    console.log(`[auth] dev verification code ${email}: ${verificationCode}`);
  } else {
    // Send the email. On failure, delete the challenge immediately — so the user isn't stuck
    // behind the 60s rate limit and can retry right away.
    try {
      const tmpl = buildVerificationEmail(verificationCode, localeFromRequest(c));
      await sendEmail({ to: email, ...tmpl });
    } catch (err) {
      await prisma.emailLoginChallenge.delete({ where: { id: challengeId } }).catch(() => {});
      console.error('[auth] sendEmail failed', err);
      return apiError(c, 'SERVICE_UNAVAILABLE', m(c, 'emailSendFailed'));
    }
  }

  return c.json({ challengeId, expiresIn: VERIFICATION_CODE_TTL_MS / 1000 });
});

// === POST /api/auth/email/verify ===
//
// Two-factor step two: verify with challengeId + code. On success → create/reuse User → consume
// the invite code → issue a session.
// On failure: attempts++; reject when attempts ≥ 5 (brute-force protection).
const emailVerifyBody = z.object({
  challengeId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'code must be 6 digits'),
});

const MAX_VERIFY_ATTEMPTS = 5;

authRoute.post('/email/verify', validateJson(emailVerifyBody), async (c) => {
  const { challengeId, code } = c.req.valid('json');

  const challenge = await prisma.emailLoginChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'codeInvalidated'));
  }
  if (challenge.consumedAt) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'codeAlreadyUsed'));
  }
  if (challenge.expiresAt < new Date()) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'codeExpired'));
  }
  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'tooManyAttempts'));
  }

  const expected = createHash('sha256').update(code).digest('hex');
  if (expected !== challenge.codeHash) {
    await prisma.emailLoginChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    return apiError(c, 'VALIDATION_FAILED', m(c, 'codeWrong'));
  }

  // Passed verification: mark consumed. Even if creating the user later fails, this challenge must
  // not be retried (replay protection).
  await prisma.emailLoginChallenge.update({
    where: { id: challengeId },
    data: { consumedAt: new Date() },
  });

  let user = await prisma.user.findUnique({ where: { email: challenge.email } });

  if (!user) {
    // Registration path: re-validate the invite code (it may have been consumed by someone else
    // between request and verify)
    if (!challenge.inviteCode) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'registerNeedsInvite'));
    }
    const inviteCode = challenge.inviteCode;
    const codeRow = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
    if (!codeRow || codeRow.status !== 'unused') {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'inviteCodeExpired'));
    }

    // Transaction: create user + mark invite used. Roll back if either fails.
    user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { id: ulid(), email: challenge.email, status: 'active' },
      });
      await tx.inviteCode.update({
        where: { code: inviteCode },
        data: { status: 'used', usedByEmail: u.email, usedAt: new Date() },
      });
      return u;
    });
  } else if (user.status !== 'active') {
    return apiError(c, 'FORBIDDEN', m(c, 'accountDisabled'));
  }

  const session = await createSession(user.id);
  setSessionCookie(c, session.id, session.expiresAt);

  return c.json({ user: { id: user.id, email: user.email, name: user.name } });
});

// === POST /api/auth/dev/login ===
//
// Enabled only when NODE_ENV !== 'production'. { email } → find/create user → issue a session
// cookie.
// A dev/test entry point; the production process does not register this route at all.
const devLoginBody = z.object({ email: emailField });

if (process.env.NODE_ENV !== 'production') {
  authRoute.post('/dev/login', validateJson(devLoginBody), async (c) => {
    const { email } = c.req.valid('json');

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { id: ulid(), email } });
    }
    if (user.status !== 'active') {
      return apiError(c, 'FORBIDDEN', 'account disabled');
    }

    const session = await createSession(user.id);
    setSessionCookie(c, session.id, session.expiresAt);

    return c.json({ user: { id: user.id, email: user.email, name: user.name } });
  });
}
