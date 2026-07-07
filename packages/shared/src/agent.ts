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

export type AgentStreamEvent =
  | { type: 'snapshot'; text: string; trace: ToolTraceItem[] } // first frame on every (re)subscribe
  | { type: 'delta'; text: string } // produce-phase text tokens (repair rounds don't stream)
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
