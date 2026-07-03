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

// A backtest Job (runs in a worker). Poll carries the log lines after `since` + `nextSince`. Status
// only — the result lands on Strategy.lastResult (fetch it on done). 'stale' = the run's process died.
export interface BacktestJob {
  status: 'running' | 'done' | 'error' | 'stale';
  logs: string[];
  nextSince: number;
  error?: string | null;
}

// Submit a backtest for a saved strategy; returns a jobId to poll. The result is written to the
// strategy's lastResult by the worker on completion.
export function submitBacktest(
  config: BacktestConfig,
  strategyId: string,
): Promise<{ jobId: string }> {
  return request(`/api/app/backtest?strategyId=${encodeURIComponent(strategyId)}`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

// Poll a backtest job — `since` = how many log lines the client already has (incremental tail).
export function pollBacktest(jobId: string, since = 0): Promise<BacktestJob> {
  return request(`/api/app/backtest/${jobId}?since=${since}`);
}

// A still-running backtest job for a strategy — to re-attach after a refresh (DB-backed, no localStorage).
export function findBacktestRunningJob(strategyId: string): Promise<{ jobId: string | null }> {
  return request(`/api/app/backtest/running?strategyId=${encodeURIComponent(strategyId)}`);
}

import type {
  ScreenQueryResponse,
  ScreenResult,
  ScreenSpec,
  StockSeries,
  SavedMeta,
  SavedStrategy,
  SavedScreenQuery,
  StrategyCard,
} from '@jixie/shared';

// NL→code: turn a natural-language strategy description into a compilable TS strategy module.
export function generateCode(text: string): Promise<{ code: string; attempts: number }> {
  return request('/api/app/strategy/codegen', { method: 'POST', body: JSON.stringify({ text }) });
}

// NL→name: let the model name a strategy from its code (when 策略名称 is left blank).
export function generateName(code: string): Promise<{ name: string }> {
  return request('/api/app/strategy/name', { method: 'POST', body: JSON.stringify({ code }) });
}

// —— Saved strategies (产品线 1 持久化) —— auto-saved on backtest run; name = config.name (upsert).

export function listStrategies(): Promise<StrategyCard[]> {
  return request('/api/app/strategies');
}

export function getStrategy(id: string): Promise<SavedStrategy> {
  return request(`/api/app/strategies/${id}`);
}

export function saveStrategy(config: BacktestConfig): Promise<SavedMeta> {
  return request('/api/app/strategies', { method: 'POST', body: JSON.stringify(config) });
}

// Persist a finished run's result onto the strategy (by name) — shown on reopen.
export function saveBacktestResult(name: string, result: BacktestSummary): Promise<{ ok: true }> {
  return request('/api/app/strategies/result', {
    method: 'POST',
    body: JSON.stringify({ name, result }),
  });
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
export function fetchStockSeries(
  code: string,
  start = '20150101',
  end = '20241231',
): Promise<StockSeries> {
  return request(`/api/app/stock/${code}/series?start=${start}&end=${end}`);
}

// tsCode → name (bulk) — e.g. the traded-instruments queue in 交易详情.
export function fetchNames(codes: string[]): Promise<Record<string, string>> {
  return request(`/api/app/names?codes=${encodeURIComponent(codes.join(','))}`);
}

// Index daily close (e.g. 000300.SH) over a range — the benchmark return curve in 交易详情.
export function fetchIndexSeries(
  code: string,
  start: string,
  end: string,
): Promise<{ points: { date: string; close: number }[] }> {
  return request(`/api/app/index/${code}/series?start=${start}&end=${end}`);
}

import type { FactorReport, FactorMeta, FactorRun, FactorFreq } from '@jixie/shared';

// 因子研究: the factor list (identity + kind).
export function getFactorCatalog(): Promise<FactorMeta[]> {
  return request('/api/app/factors/catalog');
}

// A factor's cached runs (the "已跑" chips).
export function getFactorRuns(factor: string): Promise<FactorRun[]> {
  return request(`/api/app/factors/runs?factor=${encodeURIComponent(factor)}`);
}

// A single-factor analysis over (freq, start, end): deciles + Rank IC + long-short. Cached server-side;
// refresh=true recomputes. Price factors are ~100s cold; fundamentals/moneyflow a few seconds.
export function getFactorAnalysis(
  factor: string,
  freq: FactorFreq,
  start: string,
  end: string,
  refresh = false,
): Promise<FactorReport> {
  const q = new URLSearchParams({ factor, freq, start, end, ...(refresh ? { refresh: '1' } : {}) });
  return request(`/api/app/factors/analysis?${q}`);
}

// Streamed run: returns the cached report immediately, or a jobId to poll for progress logs.
export function runFactorAnalysis(
  factor: string,
  freq: FactorFreq,
  start: string,
  end: string,
  refresh = false,
): Promise<{ done: true; report: FactorReport } | { jobId: string }> {
  const q = new URLSearchParams({ factor, freq, start, end, ...(refresh ? { refresh: '1' } : {}) });
  return request(`/api/app/factors/analysis/run?${q}`, { method: 'POST' });
}

export interface FactorJob {
  status: 'running' | 'done' | 'error' | 'stale';
  logs: string[];
  nextSince: number;
  error?: string | null;
}
export function pollFactorJob(jobId: string, since = 0): Promise<FactorJob> {
  return request(`/api/app/factors/analysis/job/${jobId}?since=${since}`);
}

// A still-running job for this (factor, window) — to re-attach after a refresh (DB-backed, cross-client).
export function findFactorRunningJob(
  factor: string,
  freq: FactorFreq,
  start: string,
  end: string,
): Promise<{ jobId: string | null }> {
  const q = new URLSearchParams({ factor, freq, start, end });
  return request(`/api/app/factors/analysis/running?${q}`);
}
