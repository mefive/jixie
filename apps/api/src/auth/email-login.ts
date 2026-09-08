import { createHash, randomInt } from 'node:crypto';
import { ulid } from 'ulid';
import type { Locale } from '@jixie/shared';
import { prisma } from '../infra/database/prisma.js';
import { isEmailConfigured, sendEmail } from '../infra/email/email.js';
import { t } from '../i18n/index.js';
import { isValidInviteCodeFormat } from './invite-code.js';
import { buildVerificationEmail } from './verification-email.js';
import { createSession, type CreatedSession, type SessionUser } from './session.js';
import { authFailure, type AuthFailure } from './errors.js';

const VERIFICATION_CODE_TTL_MS = 10 * 60_000;
const RESEND_THROTTLE_MS = 60_000;
const MAX_VERIFY_ATTEMPTS = 5;

// Input has already passed the HTTP schema's normalization and shape validation.
export async function requestEmailLogin(
  { email, inviteCode }: { email: string; inviteCode?: string },
  locale: Locale,
): Promise<{ challengeId: string; expiresIn: number } | AuthFailure> {
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    // login case
    if (inviteCode) {
      return authFailure('VALIDATION_FAILED', t(locale, 'emailAlreadyRegistered'), {
        field: 'inviteCode',
      });
    }
    if (existingUser.status !== 'active') {
      return authFailure('FORBIDDEN', t(locale, 'accountDisabled'));
    }
  } else {
    // registration case
    if (!inviteCode) {
      return authFailure('VALIDATION_FAILED', t(locale, 'inviteCodeRequired'), {
        field: 'inviteCode',
      });
    }
    if (!isValidInviteCodeFormat(inviteCode)) {
      return authFailure('VALIDATION_FAILED', t(locale, 'inviteCodeInvalidFormat'), {
        field: 'inviteCode',
      });
    }
    const code = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
    if (!code || code.status !== 'unused') {
      return authFailure('VALIDATION_FAILED', t(locale, 'inviteCodeInvalidOrUsed'), {
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
    return authFailure('VALIDATION_FAILED', t(locale, 'codeAlreadySent'));
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
      const template = buildVerificationEmail(verificationCode, locale);
      await sendEmail({ to: email, ...template });
    } catch (error) {
      await prisma.emailLoginChallenge.delete({ where: { id: challengeId } }).catch(() => {});
      console.error('[auth] sendEmail failed', error);
      return authFailure('SERVICE_UNAVAILABLE', t(locale, 'emailSendFailed'));
    }
  }

  return { challengeId, expiresIn: VERIFICATION_CODE_TTL_MS / 1000 };
}

export async function verifyEmailLogin(
  { challengeId, code }: { challengeId: string; code: string },
  locale: Locale,
): Promise<{ user: SessionUser; session: CreatedSession } | AuthFailure> {
  const challenge = await prisma.emailLoginChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) {
    return authFailure('VALIDATION_FAILED', t(locale, 'codeInvalidated'));
  }
  if (challenge.consumedAt) {
    return authFailure('VALIDATION_FAILED', t(locale, 'codeAlreadyUsed'));
  }
  if (challenge.expiresAt < new Date()) {
    return authFailure('VALIDATION_FAILED', t(locale, 'codeExpired'));
  }
  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return authFailure('VALIDATION_FAILED', t(locale, 'tooManyAttempts'));
  }

  const expected = createHash('sha256').update(code).digest('hex');
  if (expected !== challenge.codeHash) {
    await prisma.emailLoginChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    return authFailure('VALIDATION_FAILED', t(locale, 'codeWrong'));
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
      return authFailure('VALIDATION_FAILED', t(locale, 'registerNeedsInvite'));
    }
    const inviteCode = challenge.inviteCode;
    const codeRow = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
    if (!codeRow || codeRow.status !== 'unused') {
      return authFailure('VALIDATION_FAILED', t(locale, 'inviteCodeExpired'));
    }

    // Transaction: create user + mark invite used. Roll back if either fails.
    user = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.user.create({
        data: { id: ulid(), email: challenge.email, status: 'active' },
      });
      await transaction.inviteCode.update({
        where: { code: inviteCode },
        data: { status: 'used', usedByEmail: createdUser.email, usedAt: new Date() },
      });
      return createdUser;
    });
  } else if (user.status !== 'active') {
    return authFailure('FORBIDDEN', t(locale, 'accountDisabled'));
  }

  const session = await createSession(user.id);

  return { user: { id: user.id, email: user.email, name: user.name }, session };
}
