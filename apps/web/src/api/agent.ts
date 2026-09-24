import type { AgentSqlRequest, ActiveAgentTurnRequestQuery } from '@jixie/shared/api/agent';
import type { ComputeChartRequest } from '@jixie/shared/api/chart';
import { localeStore } from '@src/i18n/locale-store';
import type {
  AgentStreamEvent,
  AgentTurnDetail,
  ComputeChartSpec,
  SqlRows,
  ToolTraceItem,
} from '@jixie/shared';
import {
  ApiError,
  serializeQuery,
  request,
  isGatewayUnavailableStatus,
  notifyServiceUnavailable,
  notifyMaintenance,
} from './client';

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
    notifyMaintenance(body?.error);
    if (body?.error?.code !== 'MAINTENANCE' && isGatewayUnavailableStatus(res.status)) {
      notifyServiceUnavailable();
    }
    throw new ApiError(
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `${res.status} ${res.statusText}`,
      body?.error?.details,
      res.status,
    );
  }
  return res;
}

// The live turn for an entity ('strategy:<id>' | 'factor:<id>' | 'research:<id>') — refresh reattach.
export function findRunningAgentTurn(entityKey: string): Promise<{ turnId: string | null }> {
  const query = serializeQuery({ entity: entityKey } satisfies ActiveAgentTurnRequestQuery);
  return request(`/api/app/agent/turns/active?${query}`);
}

// Abort the upstream LLM (idempotent; already-finished turns are a no-op).
export function cancelAgentTurn(turnId: string): Promise<{ ok: true; cancelled: boolean }> {
  return request(`/api/app/agent/turns/${turnId}/cancel`, { method: 'POST' });
}

export function getAgentTurn(turnId: string): Promise<AgentTurnDetail> {
  return request(`/api/app/agent/turns/${turnId}`);
}

// Read-only SQL over the market-table whitelist — chart cards re-run their persisted query here.
export function agentSql(sql: string): Promise<SqlRows> {
  return request('/api/app/agent/sql-queries', {
    method: 'POST',
    body: JSON.stringify({ sql } satisfies AgentSqlRequest),
  });
}

// Re-run a compute-source chart card (persisted queries + sandboxed transform → row table).
export function agentComputeChart(spec: ComputeChartSpec): Promise<SqlRows> {
  return request('/api/app/agent/chart-computations', {
    method: 'POST',
    body: JSON.stringify(spec satisfies ComputeChartRequest),
  });
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
