import { prisma } from '#infra/database/prisma.js';
import { isEmailConfigured, sendEmail } from '#infra/email/email.js';
import type { Locale } from '@jixie/shared';
import { createHash, randomInt } from 'node:crypto';
import { ulid } from 'ulid';
import { AuthError } from './errors.js';
import { isValidInviteCodeFormat } from './invite-code.js';
import { createSession, type CreatedSession, type SessionUser } from './session.js';
import { buildVerificationEmail } from './verification-email.js';

const VERIFICATION_CODE_TTL_MS = 10 * 60_000;
const RESEND_THROTTLE_MS = 60_000;
const MAX_VERIFY_ATTEMPTS = 5;

// Input has already passed the HTTP schema's normalization and shape validation.
export async function requestEmailLogin(
  { email, inviteCode }: { email: string; inviteCode?: string },
  locale: Locale,
): Promise<{ challengeId: string; expiresIn: number }> {
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    // login case
    if (inviteCode) {
      throw new AuthError('email_already_registered', {
        details: {
          field: 'inviteCode',
        },
      });
    }
    if (existingUser.status !== 'active') {
      throw new AuthError('account_disabled');
    }
  } else {
    // registration case
    if (!inviteCode) {
      throw new AuthError('invite_code_required', {
        details: {
          field: 'inviteCode',
        },
      });
    }
    if (!isValidInviteCodeFormat(inviteCode)) {
      throw new AuthError('invite_code_invalid_format', {
        details: {
          field: 'inviteCode',
        },
      });
    }
    const code = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
    if (!code || code.status !== 'unused') {
      throw new AuthError('invite_code_invalid_or_used', {
        details: {
          field: 'inviteCode',
        },
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
    throw new AuthError('code_already_sent');
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
      throw new AuthError('email_send_failed', { cause: error });
    }
  }

  return { challengeId, expiresIn: VERIFICATION_CODE_TTL_MS / 1000 };
}

export async function verifyEmailLogin({
  challengeId,
  code,
}: {
  challengeId: string;
  code: string;
}): Promise<{ user: SessionUser; session: CreatedSession }> {
  const challenge = await prisma.emailLoginChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) {
    throw new AuthError('code_invalidated');
  }
  if (challenge.consumedAt) {
    throw new AuthError('code_already_used');
  }
  if (challenge.expiresAt < new Date()) {
    throw new AuthError('code_expired');
  }
  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw new AuthError('too_many_attempts');
  }

  const expected = createHash('sha256').update(code).digest('hex');
  if (expected !== challenge.codeHash) {
    await prisma.emailLoginChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    throw new AuthError('code_wrong');
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
      throw new AuthError('register_needs_invite');
    }
    const inviteCode = challenge.inviteCode;
    const codeRow = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
    if (!codeRow || codeRow.status !== 'unused') {
      throw new AuthError('invite_code_expired');
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
    throw new AuthError('account_disabled');
  }

  const session = await createSession(user.id);

  return { user: { id: user.id, email: user.email, name: user.name }, session };
}
