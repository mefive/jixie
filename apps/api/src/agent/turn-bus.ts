import type { AgentStreamEvent, ToolTraceItem } from '@jixie/shared';

/**
 * In-memory pub/sub for in-flight agent turns — one entry per turnId (pattern borrowed from
 * marginalia's streamBus). Work model:
 *   start()       route registers the turn + gets the AbortSignal (before spawning the runner)
 *   publish()     runner forwards incremental events; text/trace accumulate for replay
 *   finish()      runner's terminal event (done/error/cancelled); starts the TTL
 *   subscribe()   SSE endpoint joins; FIRST frame is always a snapshot of the accumulated state,
 *                 so a resubscriber (page refresh) replaces local state and continues seamlessly
 *   cancel()      cancel endpoint aborts the upstream LLM; the runner emits the terminal event
 *   findRunning() "is there a live turn for this entity?" — the refresh-reattach discovery
 *
 * Single-process by design (same constraint as the rest of the API: one Node + SQLite). No DB
 * status/heartbeat/sweeper: liveness lives here only — a process restart simply forgets in-flight
 * turns, findRunning returns null, and the frontend shows the conversation as persisted (the user
 * message is written before the turn starts; the reply just never lands). Concurrency: JS is
 * single-threaded — subscribe's "snapshot then join" must stay synchronous (no await inside).
 */
interface TurnEntry {
  turnId: string;
  userId: string; // subscription auth: only the owner may attach
  entityKey: string | null; // 'strategy:<id>' | 'factor:<id>' | 'screen:<id>'; null = ephemeral (QA)
  accText: string; // produce-phase text so far (snapshot replay)
  trace: ToolTraceItem[]; // completed tool calls so far (snapshot replay)
  controller: AbortController;
  done: boolean;
  finalEvent: AgentStreamEvent | null;
  subscribers: Set<(ev: AgentStreamEvent) => void>;
  ttlTimer: ReturnType<typeof setTimeout> | null;
}

const turns = new Map<string, TurnEntry>();

// How long a finished turn stays subscribable — covers the "done right as the client resubscribes"
// window; afterwards the persisted message (already in the entity row) is the source of truth.
const DONE_TTL_MS = 60_000;

export function start(
  turnId: string,
  userId: string,
  entityKey: string | null,
): { signal: AbortSignal } {
  if (turns.has(turnId)) {
    throw new Error(`turnBus: ${turnId} already started`);
  }
  const controller = new AbortController();
  turns.set(turnId, {
    turnId,
    userId,
    entityKey,
    accText: '',
    trace: [],
    controller,
    done: false,
    finalEvent: null,
    subscribers: new Set(),
    ttlTimer: null,
  });
  return { signal: controller.signal };
}

/** Forward an incremental event to subscribers, accumulating what a snapshot must replay. */
export function publish(
  turnId: string,
  ev: Extract<AgentStreamEvent, { type: 'delta' | 'tool_start' | 'tool_done' | 'repair' }>,
): void {
  const turn = turns.get(turnId);
  if (!turn || turn.done) {
    return;
  }
  if (ev.type === 'delta') {
    turn.accText += ev.text;
  } else if (ev.type === 'tool_done') {
    turn.trace.push(ev.item);
  }
  for (const send of turn.subscribers) {
    try {
      send(ev);
    } catch (err) {
      console.error('[turnBus] subscriber send threw', err);
    }
  }
}

/** Terminal event (done/error/cancelled): broadcast, clear subscribers, start the TTL. */
export function finish(
  turnId: string,
  finalEvent: Extract<AgentStreamEvent, { type: 'done' | 'error' | 'cancelled' }>,
): void {
  const turn = turns.get(turnId);
  if (!turn || turn.done) {
    return;
  }
  turn.done = true;
  turn.finalEvent = finalEvent;
  for (const send of turn.subscribers) {
    try {
      send(finalEvent);
    } catch (err) {
      console.error('[turnBus] subscriber send threw on finish', err);
    }
  }
  turn.subscribers.clear();
  turn.ttlTimer = setTimeout(() => {
    turns.delete(turnId);
  }, DONE_TTL_MS);
}

/** Abort the upstream LLM; the runner's catch emits the terminal event. False = nothing to cancel. */
export function cancel(turnId: string, userId: string): boolean {
  const turn = turns.get(turnId);
  if (!turn || turn.done || turn.userId !== userId) {
    return false;
  }
  turn.controller.abort();
  return true;
}

export type SubscribeResult =
  | { kind: 'live'; unsubscribe: () => void; closed: Promise<void> }
  | { kind: 'finished' }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

/** Join a turn's stream. Synchronous through "snapshot → add subscriber" (no await — events
 * published concurrently must not interleave with the replay). */
export function subscribe(
  turnId: string,
  userId: string,
  send: (ev: AgentStreamEvent) => void,
): SubscribeResult {
  const turn = turns.get(turnId);
  if (!turn) {
    return { kind: 'not_found' };
  }
  if (turn.userId !== userId) {
    return { kind: 'forbidden' };
  }

  // The first frame is ALWAYS the snapshot — the subscriber replaces its local state with the
  // server's accumulation (an empty one still signals "you are now in sync").
  send({ type: 'snapshot', text: turn.accText, trace: [...turn.trace] });

  if (turn.done) {
    if (turn.finalEvent) {
      send(turn.finalEvent);
    }
    return { kind: 'finished' };
  }

  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const wrapped = (ev: AgentStreamEvent) => {
    send(ev);
    if (ev.type === 'done' || ev.type === 'error' || ev.type === 'cancelled') {
      resolveClosed();
    }
  };
  turn.subscribers.add(wrapped);

  return {
    kind: 'live',
    unsubscribe: () => {
      turn.subscribers.delete(wrapped);
      resolveClosed();
    },
    closed,
  };
}

/** The live turn for an entity, if any — powers refresh-reattach discovery and the "one turn per
 * entity at a time" guard on the start endpoints. */
export function findRunning(entityKey: string, userId: string): string | null {
  for (const turn of turns.values()) {
    if (!turn.done && turn.entityKey === entityKey && turn.userId === userId) {
      return turn.turnId;
    }
  }
  return null;
}

/** Test-only teardown. */
export function _resetForTest(): void {
  for (const turn of turns.values()) {
    if (turn.ttlTimer) {
      clearTimeout(turn.ttlTimer);
    }
  }
  turns.clear();
}
