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

export const authRoute = new Hono();

// 邮箱归一：trim + lowercase。所有写库/查库都走这个形态，避免大小写引出俩账号。
const emailField = z
  .string()
  .trim()
  .email()
  .transform((s) => s.toLowerCase());

// === GET /api/auth/me ===
//
// 返回当前登录用户。**故意不强制 401**：未登录返 { user: null }，已登录返 { user }。
// 前端启动调一次 /me 就能决定跳登录页还是进首页，不需要先撞 401 再恢复。
authRoute.get('/me', async (c) => {
  const sid = getSessionId(c);
  if (!sid) return c.json({ user: null });

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
// 删 Session 行 + 清 cookie。幂等：未登录调用也返 ok。
authRoute.post('/logout', async (c) => {
  const sid = getSessionId(c);
  if (sid) await destroySession(sid);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// === POST /api/auth/email/request ===
//
// 双因子第一步：邮箱（+ 邀请码，仅注册场景）→ 服务端生成 6 位验证码 → 发邮件
// → 返回 challengeId 给前端，第二步带 challengeId + code 调 /verify。
//
// 注册 vs 登录由"邮箱是否已在 User 表"区分：已注册不能传邀请码，未注册必须传有效未消费邀请码。
const emailRequestBody = z.object({
  email: emailField,
  inviteCode: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? normalizeInviteCode(v) : undefined)),
});

const VERIFICATION_CODE_TTL_MS = 10 * 60_000; // 10 分钟
const RESEND_THROTTLE_MS = 60_000; // 60 秒内同邮箱不能重发

authRoute.post('/email/request', validateJson(emailRequestBody), async (c) => {
  const { email, inviteCode } = c.req.valid('json');

  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    // 登录场景
    if (inviteCode) {
      return apiError(c, 'VALIDATION_FAILED', '该邮箱已注册，登录无需邀请码', {
        field: 'inviteCode',
      });
    }
    if (existingUser.status !== 'active') {
      return apiError(c, 'FORBIDDEN', '账号已被禁用');
    }
  } else {
    // 注册场景
    if (!inviteCode) {
      return apiError(c, 'VALIDATION_FAILED', '新邮箱注册需要邀请码', { field: 'inviteCode' });
    }
    if (!isValidInviteCodeFormat(inviteCode)) {
      return apiError(c, 'VALIDATION_FAILED', '邀请码格式不正确', { field: 'inviteCode' });
    }
    const code = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
    if (!code || code.status !== 'unused') {
      return apiError(c, 'VALIDATION_FAILED', '邀请码无效或已使用', { field: 'inviteCode' });
    }
  }

  // 限流：60s 内一条未消费、未过期的 challenge 存在则拒绝重发
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
    return apiError(c, 'VALIDATION_FAILED', '验证码已发送，请稍后再试');
  }

  // 生成 6 位数字验证码。randomInt 是密码学安全随机；100000~999999 共 90 万种。
  const verificationCode = String(randomInt(100_000, 1_000_000));
  const challengeId = ulid();
  const codeHash = createHash('sha256').update(verificationCode).digest('hex');
  const now = new Date();

  await prisma.emailLoginChallenge.create({
    data: {
      id: challengeId,
      email,
      // 注册场景才记邀请码（verify 时再次校验且消费它）；登录场景为 null
      inviteCode: existingUser ? null : inviteCode,
      codeHash,
      expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
    },
  });

  // dev fallback：Resend 未配置且非生产 → 把验证码打印到控制台，不真发邮件，方便本地自测。
  if (!isEmailConfigured() && process.env.NODE_ENV !== 'production') {
    console.log(`[auth] dev 验证码 ${email}: ${verificationCode}`);
  } else {
    // 发邮件。失败立刻删 challenge——避免被 60s 限流卡住，让用户能立刻重试。
    try {
      const tmpl = buildVerificationEmail(verificationCode);
      await sendEmail({ to: email, ...tmpl });
    } catch (err) {
      await prisma.emailLoginChallenge.delete({ where: { id: challengeId } }).catch(() => {});
      console.error('[auth] sendEmail failed', err);
      return apiError(c, 'SERVICE_UNAVAILABLE', '邮件发送失败，请稍后重试');
    }
  }

  return c.json({ challengeId, expiresIn: VERIFICATION_CODE_TTL_MS / 1000 });
});

// === POST /api/auth/email/verify ===
//
// 双因子第二步：用 challengeId + code 验证。成功 → 创建/复用 User → 消费邀请码 → 发 session。
// 失败：attempts++；attempts ≥ 5 拒绝（防爆破）。
const emailVerifyBody = z.object({
  challengeId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, '验证码必须是 6 位数字'),
});

const MAX_VERIFY_ATTEMPTS = 5;

authRoute.post('/email/verify', validateJson(emailVerifyBody), async (c) => {
  const { challengeId, code } = c.req.valid('json');

  const challenge = await prisma.emailLoginChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) {
    return apiError(c, 'VALIDATION_FAILED', '验证码已失效，请重新申请');
  }
  if (challenge.consumedAt) {
    return apiError(c, 'VALIDATION_FAILED', '验证码已被使用');
  }
  if (challenge.expiresAt < new Date()) {
    return apiError(c, 'VALIDATION_FAILED', '验证码已过期，请重新申请');
  }
  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return apiError(c, 'VALIDATION_FAILED', '验证次数过多，请重新申请验证码');
  }

  const expected = createHash('sha256').update(code).digest('hex');
  if (expected !== challenge.codeHash) {
    await prisma.emailLoginChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    return apiError(c, 'VALIDATION_FAILED', '验证码错误');
  }

  // 通过校验：标 consumed。即使后面建 user 失败，也不允许这条 challenge 再被尝试（防重放）。
  await prisma.emailLoginChallenge.update({
    where: { id: challengeId },
    data: { consumedAt: new Date() },
  });

  let user = await prisma.user.findUnique({ where: { email: challenge.email } });

  if (!user) {
    // 注册路径：再次校验邀请码（可能在 request 与 verify 之间被别人吃了）
    if (!challenge.inviteCode) {
      return apiError(c, 'VALIDATION_FAILED', '注册需要邀请码，请重新申请');
    }
    const inviteCode = challenge.inviteCode;
    const codeRow = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
    if (!codeRow || codeRow.status !== 'unused') {
      return apiError(c, 'VALIDATION_FAILED', '邀请码已失效，请重新申请');
    }

    // 事务：建 user + 标 invite used。任一失败回滚。
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
    return apiError(c, 'FORBIDDEN', '账号已被禁用');
  }

  const session = await createSession(user.id);
  setSessionCookie(c, session.id, session.expiresAt);

  return c.json({ user: { id: user.id, email: user.email, name: user.name } });
});

// === POST /api/auth/dev/login ===
//
// 仅 NODE_ENV !== 'production' 启用。{ email } → 找/建 user → 发 session cookie。
// 开发/测试入口；线上 production 进程根本不注册这条路由。
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
