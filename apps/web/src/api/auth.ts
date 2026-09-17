import type {
  EmailLoginRequest,
  VerifyEmailLoginRequest,
  DevelopmentLoginRequest,
} from '@jixie/shared/api/auth';
import { request } from './client';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

// Current auth state. The backend deliberately always returns 200: when not logged in it returns { user: null }
export function fetchMe(): Promise<{ user: AuthUser | null }> {
  return request('/api/auth/me');
}

export function devLogin(email: string): Promise<{ user: AuthUser }> {
  return request('/api/auth/dev/login', {
    method: 'POST',
    body: JSON.stringify({ email } satisfies DevelopmentLoginRequest),
  });
}

// Send code. A new email must include inviteCode; an existing email doesn't. A new email without a code returns VALIDATION_FAILED + field=inviteCode
export function requestEmailLogin(
  input: EmailLoginRequest,
): Promise<{ challengeId: string; expiresIn: number }> {
  return request('/api/auth/email/request', {
    method: 'POST',
    body: JSON.stringify(input satisfies EmailLoginRequest),
  });
}

// Verify code to log in / register. On success it writes the session cookie
export function verifyEmailLogin(input: VerifyEmailLoginRequest): Promise<{ user: AuthUser }> {
  return request('/api/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify(input satisfies VerifyEmailLoginRequest),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST' });
}
