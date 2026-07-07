// Thin frontend API wrapper. The backend uses a uniform error shape { error: { code, message, details? } },
// which we parse into an ApiError and throw; on success we return JSON.
// Sessions rely on an httpOnly cookie (same-origin via vite proxy), fetch sends the cookie by default, the frontend stores no token.
// Every request carries Accept-Language so the API localizes its user-facing messages and the agent replies in the user's language.

import { localeStore } from '@src/i18n/locale-store';

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
    headers: {
      'content-type': 'application/json',
      'accept-language': localeStore.locale,
      ...(init?.headers ?? {}),
    },
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

import type {
  AgentStreamEvent,
  BacktestConfig,
  ChatMessage,
  LogLine,
  SqlRows,
  ToolTraceItem,
} from '@jixie/shared';

// Back-compat alias — the trace item type now lives in shared (agent-stream protocol).
export type AgentToolTraceItem = ToolTraceItem;

// —— Agent turn streaming (SSE) ——
// Two-step, marginalia-style: the surface POST starts a background turn and returns a turnId; then
// GET /agent/turns/:id/stream subscribes. Any client can (re)attach at any time — the first frame is
// always a snapshot — which is what makes a page refresh resume the stream.

// Subscribe to a turn's SSE stream. `signal` cancels the SUBSCRIPTION only (the turn keeps running
// server-side); to stop the turn itself call cancelAgentTurn.
export async function subscribeAgentTurn(turnId: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`/api/app/agent/turns/${turnId}/stream`, {
    signal,
    headers: { 'accept-language': localeStore.locale },
  });
  if (!res.ok) {
    const body = (await res.json().catch((): null => null)) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    throw new ApiError(
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `${res.status} ${res.statusText}`,
      body?.error?.details,
    );
  }
  return res;
}

// The live turn for an entity ('strategy:<id>' | 'factor:<id>' | 'screen:<id>') — refresh reattach.
export function findRunningAgentTurn(entityKey: string): Promise<{ turnId: string | null }> {
  return request(`/api/app/agent/turns/running?entity=${encodeURIComponent(entityKey)}`);
}

// Abort the upstream LLM (idempotent; already-finished turns are a no-op).
export function cancelAgentTurn(turnId: string): Promise<{ ok: true; cancelled: boolean }> {
  return request(`/api/app/agent/turns/${turnId}/cancel`, { method: 'POST' });
}

// Read-only SQL over the market-table whitelist — chart cards re-run their persisted query here.
export function agentSql(sql: string): Promise<SqlRows> {
  return request('/api/app/agent/sql', { method: 'POST', body: JSON.stringify({ sql }) });
}

// Parse an SSE body (hono streamSSE: `data: <json>\n\n` frames). fetch + ReadableStream instead of
// EventSource — EventSource can't attach an AbortSignal or read a failed response body.
export async function* readSSE(res: Response): AsyncGenerator<AgentStreamEvent> {
  if (!res.body) {
    throw new Error('SSE response has no body');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; one event may carry several `data:` lines.
      let separator: number;
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''));
        if (dataLines.length === 0) {
          continue;
        }
        try {
          yield JSON.parse(dataLines.join('\n')) as AgentStreamEvent;
        } catch (e) {
          console.error('SSE parse failed', e, dataLines);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// A backtest Job (runs in a worker). Poll carries the log lines after `since` + `nextSince`. Status
// only — the result lands on Strategy.lastResult (fetch it on done). 'stale' = the run's process died.
// Logs are tagged LogLine (system progress vs the strategy's own console.*).
export interface BacktestJob {
  status: 'running' | 'done' | 'error' | 'stale';
  logs: LogLine[];
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
  ScreenConversationDetail,
  ScreenConversationMeta,
  ScreenResult,
  ScreenSpec,
  StockSeries,
  SavedMeta,
  SavedStrategy,
  SavedScreenQuery,
  StrategyCard,
} from '@jixie/shared';

// NL→name: the model proposes a short strategy name. Pass `prompt` to name a brand-new strategy from
// its request (before any code); pass `code` (+ `currentName`) to name from the code on a run — the
// model keeps currentName when it still fits, only renaming when the logic has drifted.
export function generateStrategyName(input: {
  code?: string;
  prompt?: string;
  currentName?: string;
}): Promise<{ name: string }> {
  return request('/api/app/strategy/name', { method: 'POST', body: JSON.stringify(input) });
}

// Agent: START one turn (the model iterates on the current code; history lives on the strategy row).
// Returns a turnId immediately — subscribe via subscribeAgentTurn to stream the reply.
export function sendAgent(
  strategyId: string,
  message: string,
  code: string,
): Promise<{ turnId: string }> {
  return request('/api/app/strategy/agent', {
    method: 'POST',
    body: JSON.stringify({ id: strategyId, message, code }),
  });
}

// —— Saved strategies (product line 1 persistence) —— created on the first Agent prompt, then updated by id:
// messages in real time, config/name on a run.

export function listStrategies(): Promise<StrategyCard[]> {
  return request('/api/app/strategies');
}

export function getStrategy(id: string): Promise<SavedStrategy> {
  return request(`/api/app/strategies/${id}`);
}

// Create a NEW strategy row (up front on the first Agent prompt, or on the first run of a hand-written
// one). config + name are the initial values; later updates go by id (updateStrategy).
export function createStrategy(
  config: BacktestConfig,
  messages?: ChatMessage[],
): Promise<SavedMeta> {
  const body = messages ? { ...config, messages } : config;
  return request('/api/app/strategies', { method: 'POST', body: JSON.stringify(body) });
}

// Update an existing strategy by id. `{ messages }` alone = real-time chat save (config untouched);
// `{ config }` = a run's config/name update (drops the stale lastResult when code/range/capital moved).
export function updateStrategy(
  id: string,
  patch: { config?: BacktestConfig; messages?: ChatMessage[] },
): Promise<SavedMeta> {
  return request(`/api/app/strategies/${id}`, { method: 'POST', body: JSON.stringify(patch) });
}

export function deleteStrategy(id: string): Promise<{ ok: true }> {
  return request(`/api/app/strategies/${id}`, { method: 'DELETE' });
}

// —— Saved screens (product line 2 persistence) —— saved on demand; { name, spec } upsert by name.

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

// —— Screener (product line 2) ——

// Run a structured screen against the latest snapshot.
export function runScreen(spec: ScreenSpec): Promise<ScreenResult> {
  return request('/api/app/screen', { method: 'POST', body: JSON.stringify(spec) });
}

// Screen agent: START one turn (screening/lookup go through the agent's read-only tools; an executed
// screen surfaces as a query card). History lives on the conversation row.
export function sendScreenAgent(
  conversationId: string,
  message: string,
): Promise<{ turnId: string }> {
  return request('/api/app/screen/agent', {
    method: 'POST',
    body: JSON.stringify({ conversationId, message }),
  });
}

// —— Screen conversations (the card wall's "conversation cards") —— created on the first turn, messages saved per turn.

export function listScreenConversations(): Promise<ScreenConversationMeta[]> {
  return request('/api/app/screen/conversations');
}

export function getScreenConversation(id: string): Promise<ScreenConversationDetail> {
  return request(`/api/app/screen/conversations/${id}`);
}

export function createScreenConversation(
  title: string,
  messages: ChatMessage[],
): Promise<{ id: string; title: string }> {
  return request('/api/app/screen/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, messages }),
  });
}

export function updateScreenConversation(
  id: string,
  patch: { title?: string; messages?: ChatMessage[] },
): Promise<{ ok: true }> {
  return request(`/api/app/screen/conversations/${id}`, {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export function deleteScreenConversation(id: string): Promise<{ ok: true }> {
  return request(`/api/app/screen/conversations/${id}`, { method: 'DELETE' });
}

// A stock's OHLC/vol/pe series for the candlestick/PE/volume charts.
export function fetchStockSeries(
  code: string,
  start = '20150101',
  end = '20241231',
): Promise<StockSeries> {
  return request(`/api/app/stock/${code}/series?start=${start}&end=${end}`);
}

// tsCode → name (bulk) — e.g. the traded-instruments queue in Trade detail.
export function fetchNames(codes: string[]): Promise<Record<string, string>> {
  return request(`/api/app/names?codes=${encodeURIComponent(codes.join(','))}`);
}

// Index daily close (e.g. 000300.SH) over a range — the benchmark return curve in Trade detail.
export function fetchIndexSeries(
  code: string,
  start: string,
  end: string,
): Promise<{ points: { date: string; close: number }[] }> {
  return request(`/api/app/index/${code}/series?start=${start}&end=${end}`);
}

import type { FactorReport, FactorMeta, FactorRun, FactorFreq } from '@jixie/shared';

// Factor research: the factor list (identity + kind) — preset + this user's custom factors.
export function getFactorCatalog(): Promise<FactorMeta[]> {
  return request('/api/app/factors/catalog');
}

// —— Custom factors (code-first, Agent-authored) —— created on the first Agent prompt, then updated by
// id: messages in real time, code/name on an analysis run. Mirrors the strategy workbench.
export interface CustomFactorMeta {
  id: string;
  name: string;
  updatedAt: string;
}
export function getCustomFactor(id: string): Promise<{
  id: string;
  name: string;
  code: string;
  messages?: ChatMessage[] | null;
  builtin?: boolean; // preset rows are readable (readonly) through the same endpoint
}> {
  return request(`/api/app/factors/custom/${id}`);
}

// Copy a factor's code (a builtin preset or your own) into a NEW editable custom factor.
export function forkFactor(id: string): Promise<{ id: string; name: string }> {
  return request(`/api/app/factors/custom/${id}/fork`, { method: 'POST' });
}

// Create a NEW factor row (up front on the first Agent prompt / first run of a hand-written one).
export function createFactor(
  name: string,
  code: string,
  messages?: ChatMessage[],
): Promise<{ id: string; name: string }> {
  const body = messages ? { name, code, messages } : { name, code };
  return request('/api/app/factors/custom', { method: 'POST', body: JSON.stringify(body) });
}

// Update a factor by id. `{ messages }` = real-time chat save; `{ code, name }` = an analysis run's
// commit (drops the stale cached reports when the code moved).
export function updateFactor(
  id: string,
  patch: { code?: string; name?: string; messages?: ChatMessage[] },
): Promise<{ id: string; name: string }> {
  return request(`/api/app/factors/custom/${id}`, { method: 'POST', body: JSON.stringify(patch) });
}

export function deleteCustomFactor(id: string): Promise<{ ok: true }> {
  return request(`/api/app/factors/custom/${id}`, { method: 'DELETE' });
}

// Factor Agent: START one turn (iterates on the defineFactor code; history lives on the factor row).
export function sendFactorAgent(
  factorId: string,
  message: string,
  code: string,
): Promise<{ turnId: string }> {
  return request('/api/app/factors/agent', {
    method: 'POST',
    body: JSON.stringify({ id: factorId, message, code }),
  });
}

// Factor Q&A: ask questions about a PRESET factor — answers only, never writes code. Ephemeral (no
// host row): history rides in the request; the reply still streams via the same turnId protocol.
export function factorQa(
  history: ChatMessage[],
  message: string,
  factorName?: string,
): Promise<{ turnId: string }> {
  return request('/api/app/factors/qa', {
    method: 'POST',
    body: JSON.stringify({ history, message, factorName }),
  });
}

// NL→name for a factor. `prompt` names a brand-new factor from its request; `code` (+ `currentName`)
// names from the code, keeping currentName when it still fits (on each run).
export function generateFactorName(input: {
  code?: string;
  prompt?: string;
  currentName?: string;
}): Promise<{ name: string }> {
  return request('/api/app/factors/name', { method: 'POST', body: JSON.stringify(input) });
}

// A factor's cached runs (the "already-run" chips).
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
  logs: LogLine[];
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
