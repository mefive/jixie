import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: '',
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { default: packageExports } = await import('@prisma/client');
  fixture.directory = mkdtempSync(join(tmpdir(), 'jixie-auth-contract-'));
  const databasePath = join(fixture.directory, 'auth.db');
  writeFileSync(databasePath, '');
  return { prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

vi.mock('#infra/email/email.js', () => ({
  sendEmail: fixture.sendEmail,
  isEmailConfigured: fixture.isEmailConfigured,
}));

import { prisma } from '#infra/database/prisma.js';
import { authRoute } from './auth.js';
import { requireAuth } from './session.js';

const app = new Hono();
app.route('/api/auth', authRoute);
app.get('/protected', requireAuth, (context) => context.json({ user: context.var.user }));
const INVITE_CODE = '0123456789AB';

function post(path: string, body: unknown, language = 'en', cookie?: string) {
  return app.request(`/api/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept-language': language,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function requestCode(email = 'reader@example.com', inviteCode: string | null = INVITE_CODE) {
  const response = await post('/email/request', { email, inviteCode: inviteCode ?? undefined });
  expect(response.status).toBe(200);
  const { challengeId, expiresIn } = await response.json();
  const emailArgs = fixture.sendEmail.mock.lastCall?.[0];
  const code = emailArgs?.subject.match(/\d{6}/)?.[0];
  expect(code).toBeTruthy();
  expect(expiresIn).toBe(600);
  return { challengeId: challengeId as string, code: code as string };
}

async function seedUser(status = 'active') {
  return prisma.user.create({
    data: { id: 'fixture-user', email: 'reader@example.com', name: 'Reader', status },
  });
}

describe('authentication HTTP contract with an isolated database', () => {
  beforeAll(() => {
    const require = createRequire(import.meta.url);
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: `file:${join(fixture.directory, 'auth.db')}` },
        stdio: 'pipe',
      },
    );
  }, 30_000);

  beforeEach(async () => {
    fixture.sendEmail.mockReset().mockResolvedValue(undefined);
    fixture.isEmailConfigured.mockReset().mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await prisma.session.deleteMany();
    await prisma.emailLoginChallenge.deleteMany();
    await prisma.inviteCode.deleteMany();
    await prisma.user.deleteMany();
    await prisma.inviteCode.create({ data: { code: INVITE_CODE } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('registers a normalized email, consumes its invite and issues an HTTP-only session', async () => {
    const challenge = await requestCode(' Reader@Example.COM ', '0123-4567-89ab');
    const stored = await prisma.emailLoginChallenge.findUniqueOrThrow({
      where: { id: challenge.challengeId },
    });
    expect(stored.email).toBe('reader@example.com');
    expect(stored.inviteCode).toBe(INVITE_CODE);
    expect(stored.codeHash).toBe(createHash('sha256').update(challenge.code).digest('hex'));
    expect(stored.codeHash).not.toBe(challenge.code);

    const response = await post('/email/verify', challenge);
    expect(response.status).toBe(200);
    const { user } = await response.json();
    expect(user).toEqual({ id: expect.any(String), email: 'reader@example.com', name: null });
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(session.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
    expect(await prisma.inviteCode.findUnique({ where: { code: INVITE_CODE } })).toMatchObject({
      status: 'used',
      usedByEmail: user.email,
    });

    const me = await app.request('/api/auth/me', { headers: { cookie } });
    expect(await me.json()).toEqual({ user });
    const protectedResponse = await app.request('/protected', { headers: { cookie } });
    expect(await protectedResponse.json()).toEqual({ user });
  });

  it('rejects replay and deletes a session on idempotent logout', async () => {
    const challenge = await requestCode();
    const verification = await post('/email/verify', challenge);
    const cookie = verification.headers.get('set-cookie')!;
    const replay = await post('/email/verify', challenge);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'Verification code has already been used' },
    });
    const logout = await post('/logout', {}, 'en', cookie);
    expect(await logout.json()).toEqual({ ok: true });
    expect(logout.headers.get('set-cookie')).toContain('sid=;');
    expect(await prisma.session.count()).toBe(0);
    expect(await (await post('/logout', {})).json()).toEqual({ ok: true });
    expect(await (await app.request('/api/auth/me', { headers: { cookie } })).json()).toEqual({
      user: null,
    });
  });

  it('keeps me public but protects missing, expired and disabled sessions with distinct errors', async () => {
    expect(await (await app.request('/api/auth/me')).json()).toEqual({ user: null });
    const missing = await app.request('/protected');
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'login required' },
    });
    const user = await seedUser();
    await prisma.session.create({
      data: { id: 'expired', userId: user.id, expiresAt: new Date(0) },
    });
    const expired = await app.request('/protected', { headers: { cookie: 'sid=expired' } });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'session expired' },
    });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });
    await prisma.session.create({
      data: { id: 'disabled', userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    const disabled = await app.request('/protected', { headers: { cookie: 'sid=disabled' } });
    expect(disabled.status).toBe(401);
    expect(await disabled.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'account disabled' },
    });
    expect(
      await (await app.request('/api/auth/me', { headers: { cookie: 'sid=disabled' } })).json(),
    ).toEqual({ user: null });
  });

  it('preserves localized input errors and invite-field details', async () => {
    const invalid = await post('/email/request', { email: 'not-an-email' }, 'zh-CN');
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: '入参不合法',
        details: { issues: expect.any(Array) },
      },
    });
    const missingInvite = await post('/email/request', { email: 'reader@example.com' });
    expect(missingInvite.status).toBe(400);
    expect(await missingInvite.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { field: 'inviteCode' } },
    });
    expect(fixture.sendEmail).not.toHaveBeenCalled();
  });

  it('logs in an existing user without consuming a new invite and uses secure production cookies', async () => {
    await seedUser();
    const extraInvite = await post('/email/request', {
      email: 'reader@example.com',
      inviteCode: INVITE_CODE,
    });
    expect(extraInvite.status).toBe(400);
    const challenge = await requestCode('reader@example.com', null);
    vi.stubEnv('NODE_ENV', 'production');
    const verification = await post('/email/verify', challenge);
    expect(verification.status).toBe(200);
    expect(verification.headers.get('set-cookie')).toContain('Secure');
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.inviteCode.findUnique({ where: { code: INVITE_CODE } })).toMatchObject({
      status: 'unused',
    });
  });

  it('enforces the resend interval but deletes a failed delivery challenge before retry', async () => {
    fixture.sendEmail.mockRejectedValueOnce(new Error('fixture delivery failure'));
    const failed = await post('/email/request', {
      email: 'reader@example.com',
      inviteCode: INVITE_CODE,
    });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await prisma.emailLoginChallenge.count()).toBe(0);
    await requestCode();
    const throttled = await post('/email/request', {
      email: 'reader@example.com',
      inviteCode: INVITE_CODE,
    });
    expect(throttled.status).toBe(400);
    expect(await prisma.emailLoginChallenge.count()).toBe(1);
    expect(fixture.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('increments wrong-code attempts and rejects the correct code after the fifth failure', async () => {
    const challenge = await requestCode();
    const wrong = challenge.code === '100000' ? '100001' : '100000';
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await post('/email/verify', { ...challenge, code: wrong });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: 'VALIDATION_FAILED', message: 'Incorrect verification code' },
      });
    }
    const response = await post('/email/verify', challenge);
    expect(response.status).toBe(400);
    expect(
      await prisma.emailLoginChallenge.findUnique({ where: { id: challenge.challengeId } }),
    ).toMatchObject({ attempts: 5, consumedAt: null });
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it('rejects expired and missing challenges without creating a user', async () => {
    const challenge = await requestCode();
    await prisma.emailLoginChallenge.update({
      where: { id: challenge.challengeId },
      data: { expiresAt: new Date(0) },
    });
    expect((await post('/email/verify', challenge)).status).toBe(400);
    expect((await post('/email/verify', { challengeId: 'missing', code: '100000' })).status).toBe(
      400,
    );
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it('consumes a valid challenge even when its invite was revoked between request and verification', async () => {
    const challenge = await requestCode();
    await prisma.inviteCode.update({ where: { code: INVITE_CODE }, data: { status: 'revoked' } });
    expect((await post('/email/verify', challenge)).status).toBe(400);
    expect(
      (await prisma.emailLoginChallenge.findUniqueOrThrow({ where: { id: challenge.challengeId } }))
        .consumedAt,
    ).not.toBeNull();
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it('rolls back user creation with invite consumption while preserving challenge replay protection', async () => {
    const challenge = await requestCode();
    // Fixture-only fault injection: fail the second write of the registration transaction.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER reject_invite_consumption BEFORE UPDATE ON InviteCode BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`,
    );
    try {
      expect((await post('/email/verify', challenge)).status).toBe(500);
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.session.count()).toBe(0);
      expect(await prisma.inviteCode.findUnique({ where: { code: INVITE_CODE } })).toMatchObject({
        status: 'unused',
      });
      expect(
        (
          await prisma.emailLoginChallenge.findUniqueOrThrow({
            where: { id: challenge.challengeId },
          })
        ).consumedAt,
      ).not.toBeNull();
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER reject_invite_consumption');
    }
  });

  it('rejects disabled accounts at both request and verification', async () => {
    const user = await seedUser();
    const challenge = await requestCode('reader@example.com', null);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });
    expect((await post('/email/request', { email: user.email })).status).toBe(403);
    expect((await post('/email/verify', challenge)).status).toBe(403);
    expect(await prisma.session.count()).toBe(0);
  });

  it('keeps the development login route absent when imported in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { authRoute: productionAuth } = await import('./auth.js');
    const productionApp = new Hono().route('/api/auth', productionAuth);
    const response = await productionApp.request('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.com' }),
    });
    expect(response.status).toBe(404);
    expect(await prisma.user.count()).toBe(0);
  });
});
