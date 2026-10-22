import { ulid } from 'ulid';
import { getDatabase } from '#infra/database/prisma.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 返回新会话标识及有效期，供登录响应设置 Cookie。
 *
 * Return a newly created session and its expiry for login cookie handling.
 */
export interface CreatedSession {
  id: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<CreatedSession> {
  const id = ulid();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDatabase().session.create({ data: { id, userId, expiresAt } });
  return { id, expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  // deleteMany rather than delete: a missing sid does not throw, so logout is idempotent
  await getDatabase().session.deleteMany({ where: { id: sessionId } });
}

/**
 * 提供会话解析所需的用户身份信息，供鉴权上下文使用。
 *
 * Describe the user identity resolved from a session for authentication context.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * 区分有效、缺失或失效会话的解析结果，供鉴权处理。
 *
 * Distinguish session resolution outcomes for authentication handling.
 */
export type SessionResolution =
  | { kind: 'ready'; user: SessionUser }
  | { kind: 'missing' | 'expired' | 'disabled' };

/**
 * 根据会话令牌读取并验证有效期与用户身份，供 HTTP 鉴权共用。
 *
 * Resolve a session token and validate expiry and user identity for HTTP authentication.
 */
export async function resolveSession(sessionId: string | undefined): Promise<SessionResolution> {
  if (!sessionId) {
    return { kind: 'missing' };
  }

  const session = await getDatabase().session.findUnique({
    where: { id: sessionId },
    include: { user: { select: { id: true, email: true, name: true, status: true } } },
  });
  if (!session || session.expiresAt < new Date()) {
    return { kind: 'expired' };
  }
  if (session.user.status !== 'active') {
    return { kind: 'disabled' };
  }

  return {
    kind: 'ready',
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
  };
}

export async function getSessionUser(sessionId: string | undefined): Promise<SessionUser | null> {
  const resolution = await resolveSession(sessionId);
  return resolution.kind === 'ready' ? resolution.user : null;
}
