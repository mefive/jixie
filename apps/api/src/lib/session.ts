import type { MiddlewareHandler, Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { ulid } from 'ulid';
import { prisma } from './prisma.js';
import { apiError } from './httpError.js';

// === Cookie / Session 配置 ===
//
// COOKIE_NAME：刻意短，cookie 头每次请求都带，省点字节
// SESSION_TTL_MS：30 天。改这个值不会影响已发出的 session（DB 里 expiresAt 已固化）
const COOKIE_NAME = 'sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 让所有路由 handler 通过 c.var.userId / c.var.user 拿到当前用户。
// 用 module augmentation 全局扩展 Hono 的 ContextVariableMap，这是 Hono 4 推荐写法。
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
  // deleteMany 而非 delete：sid 不存在不抛错，logout 幂等
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export function setSessionCookie(c: Context, sessionId: string, expiresAt: Date): void {
  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    // 生产环境强制 https；本地 http 也要能用，所以按 NODE_ENV 切
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

// 中间件：硬要求登录态。流程：
//   cookie sid → 查 Session（join user）→ 校验未过期 + user.status=active → 注入 ctx
// 任何一步缺失返 401，让前端跳登录页；账号被 disable 的也 401。
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
