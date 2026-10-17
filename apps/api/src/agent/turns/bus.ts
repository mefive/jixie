import type {
  AgentStreamEvent,
  AgentTurnPhase,
  ToolTraceItem,
  EmbeddedAnalysisPart,
} from '@jixie/shared';

/**
 * 维护单个进行中轮次的内存事件与订阅状态，支持增量推送和刷新后重放。
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
  entityKey: string | null; // 'strategy:<id>' | 'factor:<id>' | 'research:<id>'; null = ephemeral
  accText: string; // produce-phase text so far (snapshot replay)
  accReasoning: string;
  trace: ToolTraceItem[]; // completed tool calls so far (snapshot replay)
  embeddedAnalyses: EmbeddedAnalysisPart[];
  phase?: AgentTurnPhase; // current semantic phase for refresh replay
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

/**
 * 注册进行中的 Agent 轮次并初始化回放状态，供客户端立即订阅。
 * Register an in-flight agent turn and initialize state for immediate subscription.
 */
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
    accReasoning: '',
    trace: [],
    embeddedAnalyses: [],
    phase: undefined,
    controller,
    done: false,
    finalEvent: null,
    subscribers: new Set(),
    ttlTimer: null,
  });
  return { signal: controller.signal };
}

/**
 * 广播增量事件并累积重连快照所需的内容。
 * Forward an incremental event to subscribers, accumulating what a snapshot must replay.
 */
export function publish(
  turnId: string,
  ev: Extract<
    AgentStreamEvent,
    {
      type:
        | 'delta'
        | 'reasoning_delta'
        | 'phase'
        | 'tool_start'
        | 'tool_done'
        | 'repair'
        | 'embedded_analysis';
    }
  >,
): void {
  const turn = turns.get(turnId);
  if (!turn || turn.done) {
    return;
  }
  switch (ev.type) {
    case 'delta':
      turn.accText += ev.text;
      break;
    case 'reasoning_delta':
      turn.accReasoning += ev.text;
      break;
    case 'phase':
      turn.phase = ev.phase;
      break;
    case 'tool_done':
      turn.trace.push(ev.item);
      break;
    case 'embedded_analysis':
      if (!turn.embeddedAnalyses.some((part) => part.reference.runId === ev.part.reference.runId)) {
        turn.embeddedAnalyses.push(ev.part);
      }
      break;
  }
  for (const send of turn.subscribers) {
    try {
      send(ev);
    } catch (err) {
      console.error('[turnBus] subscriber send threw', err);
    }
  }
}

/**
 * 广播终态事件、清理订阅者并启动保留期限。
 * Terminal event (done/error/cancelled): broadcast, clear subscribers, start the TTL.
 */
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

/**
 * 取消上游 LLM 请求，由执行器产生终态；无可取消轮次时返回 false。
 * Abort the upstream LLM; the runner's catch emits the terminal event. False = nothing to cancel.
 */
export function cancel(turnId: string, userId: string): boolean {
  const turn = turns.get(turnId);
  if (!turn || turn.done || turn.userId !== userId) {
    return false;
  }
  turn.controller.abort();
  return true;
}

/**
 * 承载订阅结果与清理能力，供 SSE 连接管理轮次监听。
 * Return turn subscription state and cleanup capabilities to the SSE connection.
 */
export type SubscribeResult =
  | { kind: 'live'; unsubscribe: () => void; closed: Promise<void> }
  | { kind: 'finished' }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

/**
 * 同步完成快照重放和订阅注册，避免其间插入事件导致丢失或重复。
 * Join a turn's stream. Synchronous through "snapshot → add subscriber" (no await — events
 * published concurrently must not interleave with the replay).
 */
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
  send({
    type: 'snapshot',
    text: turn.accText,
    trace: [...turn.trace],
    ...(turn.embeddedAnalyses.length ? { embeddedAnalyses: [...turn.embeddedAnalyses] } : {}),
    ...(turn.accReasoning ? { reasoning: turn.accReasoning } : {}),
    ...(turn.phase ? { phase: turn.phase } : {}),
  });

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

/**
 * 查找实体正在运行的轮次，支持刷新重连并限制同实体并发轮次。
 * The live turn for an entity, if any — powers refresh-reattach discovery and the "one turn per
 * entity at a time" guard on the start endpoints.
 */
export function findRunning(entityKey: string, userId: string): string | null {
  for (const turn of turns.values()) {
    if (!turn.done && turn.entityKey === entityKey && turn.userId === userId) {
      return turn.turnId;
    }
  }
  return null;
}

/**
 * 清理内存轮次与订阅，仅供测试隔离。
 * Test-only teardown.
 */
export function _resetForTest(): void {
  for (const turn of turns.values()) {
    if (turn.ttlTimer) {
      clearTimeout(turn.ttlTimer);
    }
  }
  turns.clear();
}
