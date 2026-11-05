import type { AuthUser } from '@jixie/shared/api/auth';
import type { SessionUser } from './session.js';

/**
 * 依据已登录邮箱和 API 环境计算发布权限。
 *
 * Derive publication permission from the signed-in email and the API environment.
 */
export function canPublishIngestion(
  user: SessionUser,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.NODE_ENV === 'development') {
    return true;
  }
  const email = user.email.trim().toLowerCase();
  const administrators = environment.JIXIE_ADMIN_EMAILS?.split(',') ?? [];

  return Boolean(email) && administrators.some((value) => value.trim().toLowerCase() === email);
}

/**
 * 登录和会话查询共用公开身份与权限映射。
 *
 * Share the public identity and capability mapping across login and session responses.
 */
export function describeAuthUser(user: SessionUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    capabilities: { publishIngestion: canPublishIngestion(user) },
  };
}
