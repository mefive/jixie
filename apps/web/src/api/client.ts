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

// —— Backtest ——

import type { BacktestConfig, BacktestSummary } from '@jixie/shared';

// A backtest job (runs in a worker on the server). Each poll carries the log lines after the cursor
// the client passed (`since`) and `nextSince` to pass next time. running → done(result) | error(message).
export type BacktestJob =
  | { status: 'running'; logs: string[]; nextSince: number }
  | { status: 'done'; logs: string[]; nextSince: number; result: BacktestSummary }
  | { status: 'error'; logs: string[]; nextSince: number; message: string };

// Submit a backtest config; returns a jobId to poll.
export function submitBacktest(config: BacktestConfig): Promise<{ jobId: string }> {
  return request('/api/app/backtest', { method: 'POST', body: JSON.stringify(config) });
}

// Poll a backtest job — `since` = how many log lines the client already has (incremental tail).
export function pollBacktest(jobId: string, since = 0): Promise<BacktestJob> {
  return request(`/api/app/backtest/${jobId}?since=${since}`);
}

import type {
  ScreenQueryResponse,
  ScreenResult,
  ScreenSpec,
  StockSeries,
  StrategyIR,
  SavedMeta,
  SavedStrategy,
  SavedScreenQuery,
} from '@jixie/shared';

// NL→IR: turn a natural-language strategy description into a validated strategy IR.
export function parseStrategy(text: string): Promise<{ ir: StrategyIR; attempts: number }> {
  return request('/api/app/strategy/parse', { method: 'POST', body: JSON.stringify({ text }) });
}

// —— Saved strategies (产品线 1 持久化) —— auto-saved on backtest run; name = config.name (upsert).

export function listStrategies(): Promise<SavedMeta[]> {
  return request('/api/app/strategies');
}

export function getStrategy(id: string): Promise<SavedStrategy> {
  return request(`/api/app/strategies/${id}`);
}

export function saveStrategy(config: BacktestConfig): Promise<SavedMeta> {
  return request('/api/app/strategies', { method: 'POST', body: JSON.stringify(config) });
}

export function deleteStrategy(id: string): Promise<{ ok: true }> {
  return request(`/api/app/strategies/${id}`, { method: 'DELETE' });
}

// —— Saved screens (产品线 2 持久化) —— saved on demand; { name, spec } upsert by name.

export function listScreens(): Promise<SavedMeta[]> {
  return request('/api/app/screens');
}

export function getScreen(id: string): Promise<SavedScreenQuery> {
  return request(`/api/app/screens/${id}`);
}

export function saveScreen(name: string, spec: ScreenSpec): Promise<SavedMeta> {
  return request('/api/app/screens', { method: 'POST', body: JSON.stringify({ name, spec }) });
}

export function deleteScreen(id: string): Promise<{ ok: true }> {
  return request(`/api/app/screens/${id}`, { method: 'DELETE' });
}

// —— Screener (产品线 2) ——

// Run a structured screen against the latest snapshot.
export function runScreen(spec: ScreenSpec): Promise<ScreenResult> {
  return request('/api/app/screen', { method: 'POST', body: JSON.stringify(spec) });
}

// One box → either a structured screen (with editable spec) or a direct instrument lookup. Tries a
// deterministic name/code match first, then the LLM.
export function queryScreen(text: string): Promise<ScreenQueryResponse> {
  return request('/api/app/screen/query', { method: 'POST', body: JSON.stringify({ text }) });
}

// A stock's OHLC/vol/pe series for the K线/PE/量 charts.
export function fetchStockSeries(code: string, start = '20150101', end = '20241231'): Promise<StockSeries> {
  return request(`/api/app/stock/${code}/series?start=${start}&end=${end}`);
}
