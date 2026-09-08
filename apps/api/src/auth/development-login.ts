import { ulid } from 'ulid';
import { prisma } from '../infra/database/prisma.js';
import { createSession } from './session.js';
import { authFailure } from './errors.js';

// Only the non-production HTTP route exposes this development operation.
export async function developmentLogin(email: string) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { id: ulid(), email } });
  }
  if (user.status !== 'active') {
    return authFailure('FORBIDDEN', 'account disabled');
  }

  const session = await createSession(user.id);
  return { user: { id: user.id, email: user.email, name: user.name }, session };
}
