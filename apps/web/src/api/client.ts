// Thin frontend API wrapper. The backend uses a uniform error shape { error: { code, message, details? } },
// which we parse into an ApiError and throw; on success we return JSON.
// Sessions rely on an httpOnly cookie (same-origin via vite proxy), fetch sends the cookie by default, the frontend stores no token.

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export class ApiError extends Error {
  public code: string;
  public field?: string;
  public details?: unknown;

  public constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    // The backend puts { field } in details for field-level errors; the login page uses it to focus the matching input
    if (details && typeof details === 'object' && 'field' in details) {
      this.field = (details as { field?: string }).field;
    }
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(
      err?.code ?? 'UNKNOWN',
      err?.message ?? `${res.status} ${res.statusText}`,
      err?.details,
    );
  }
  return body as T;
}

// Current auth state. The backend deliberately always returns 200: when not logged in it returns { user: null }
export function fetchMe(): Promise<{ user: AuthUser | null }> {
  return request('/api/auth/me');
}

// Send code. A new email must include inviteCode; an existing email doesn't. A new email without a code returns VALIDATION_FAILED + field=inviteCode
export function requestEmailLogin(input: {
  email: string;
  inviteCode?: string;
}): Promise<{ challengeId: string; expiresIn: number }> {
  return request('/api/auth/email/request', { method: 'POST', body: JSON.stringify(input) });
}

// Verify code to log in / register. On success it writes the session cookie
export function verifyEmailLogin(input: {
  challengeId: string;
  code: string;
}): Promise<{ user: AuthUser }> {
  return request('/api/auth/email/verify', { method: 'POST', body: JSON.stringify(input) });
}

export function logout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST' });
}
