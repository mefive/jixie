// Thin frontend API wrapper. The backend uses a uniform error shape { error: { code, message, details? } },
// which we parse into an ApiError and throw; on success we return JSON.
// Sessions rely on an httpOnly cookie (same-origin via vite proxy), fetch sends the cookie by default, the frontend stores no token.
// Every request carries Accept-Language so the API localizes its user-facing messages and the agent replies in the user's language.

import i18n from '@src/i18n';
import { localeStore } from '@src/i18n/locale-store';
import type { MaintenanceStatus } from './maintenance';

export class ApiError extends Error {
  public code: string;
  public field?: string;
  public details?: unknown;
  public status?: number;

  public constructor(code: string, message: string, details?: unknown, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
    // The backend puts { field } in details for field-level errors; the login page uses it to focus the matching input
    if (details && typeof details === 'object' && 'field' in details) {
      this.field = (details as { field?: string }).field;
    }
  }
}

/** Serialize an already typed HTTP query without applying server defaults or coercion. */
export function serializeQuery(query: Record<string, string | undefined>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      parameters.set(key, value);
    }
  }
  return parameters.toString();
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'accept-language': localeStore.locale,
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    notifyServiceUnavailable();
    throw new ApiError('SERVICE_UNAVAILABLE', i18n.t('common:errors.serviceUnavailable'));
  }

  const text = await res.text();
  let body: any;
  try {
    body = parseResponseBody(res, text);
  } catch (error) {
    if (isGatewayUnavailableStatus(res.status)) {
      notifyServiceUnavailable();
    }
    throw error;
  }

  if (!res.ok) {
    const err = body?.error;
    notifyMaintenance(err);
    if (err?.code !== 'MAINTENANCE' && isGatewayUnavailableStatus(res.status)) {
      notifyServiceUnavailable();
    }
    throw new ApiError(
      err?.code ?? 'UNKNOWN',
      err?.message ?? `${res.status} ${res.statusText}`,
      err?.details,
      res.status,
    );
  }
  return body as T;
}

function parseResponseBody(response: Response, text: string): any {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(
      'INVALID_RESPONSE',
      i18n.t('common:errors.serviceUnavailable'),
      {
        status: response.status,
        contentType: response.headers.get('content-type'),
      },
      response.status,
    );
  }
}

export function isGatewayUnavailableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export function notifyServiceUnavailable(): void {
  window.dispatchEvent(new Event('jixie:service-unavailable'));
}

export function notifyMaintenance(
  error: { code?: string; details?: unknown } | null | undefined,
): void {
  if (error?.code === 'MAINTENANCE' && error.details) {
    window.dispatchEvent(
      new CustomEvent<MaintenanceStatus>('jixie:maintenance', {
        detail: error.details as MaintenanceStatus,
      }),
    );
  }
}
