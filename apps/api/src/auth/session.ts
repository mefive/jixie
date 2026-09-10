import { ulid } from 'ulid';
import { prisma } from '#infra/database/prisma.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
  // deleteMany rather than delete: a missing sid does not throw, so logout is idempotent
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export type SessionResolution =
  | { kind: 'ready'; user: SessionUser }
  | { kind: 'missing' | 'expired' | 'disabled' };

export async function resolveSession(sessionId: string | undefined): Promise<SessionResolution> {
  if (!sessionId) {
    return { kind: 'missing' };
  }

  const session = await prisma.session.findUnique({
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
