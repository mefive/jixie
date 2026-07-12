import type { MessagePart } from './chat.js';

/**
 * Agent turn streaming (SSE) — the wire protocol between the background turn runner and any number
 * of subscribers (pattern borrowed from marginalia's streamBus). A turn runs server-side detached
 * from the HTTP request; POST returns a turnId immediately and GET /agent/turns/:id/stream
 * subscribes. The first frame is ALWAYS `snapshot` (the server's accumulated state), so a client
 * that (re)subscribes mid-turn — e.g. after a page refresh — replaces its local state and continues
 * seamlessly. Terminal events: done / error / cancelled.
 */
export interface ToolTraceItem {
  name: string;
  argsSummary: string; // raw JSON args, truncated — display/debug only
  ok: boolean;
  rows?: number;
  ms: number;
}

export interface AgentTurnTrace {
  version: 1;
  steps: AgentTraceStep[];
  truncated: boolean;
}

interface AgentTraceBase {
  id: string;
  sequence: number;
  modelCall?: number;
  createdAt: string;
}

export type AgentTraceStep =
  | (AgentTraceBase & {
      type: 'model';
      model: string;
      toolsEnabled: string[];
      reasoning?: string;
      status: 'running' | 'success' | 'error' | 'abort';
      durationMs?: number;
    })
  | (AgentTraceBase & {
      type: 'tool';
      toolCallId: string;
      name: string;
      arguments: string;
      observation: string;
      ok: boolean;
      rows?: number;
      durationMs: number;
      truncated?: { arguments?: boolean; observation?: boolean };
    })
  | (AgentTraceBase & {
      type: 'validation';
      round: number;
      ok: boolean;
      error?: string;
      durationMs: number;
    })
  | (AgentTraceBase & {
      type: 'error' | 'cancelled';
      message?: string;
    });

export interface AgentTurnDetail {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';
  model: string;
  trace: AgentTurnTrace;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export type AgentStreamEvent =
  | { type: 'snapshot'; text: string; trace: ToolTraceItem[]; reasoning?: string }
  | { type: 'delta'; text: string } // produce-phase text tokens (repair rounds don't stream)
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_start'; name: string; argsSummary: string }
  | { type: 'tool_done'; item: ToolTraceItem }
  | { type: 'repair'; round: number; error: string } // proposed code failed to compile; retrying
  | {
      type: 'done';
      parts: MessagePart[]; // the assistant message (server has already persisted it when this fires)
      code: string;
      changed: boolean;
      attempts: number;
      toolTrace: ToolTraceItem[];
      error?: string; // repairs exhausted — code kept unchanged (still a normal done)
    }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };
