import type { MessagePart, EmbeddedAnalysisPart } from './chat.js';
import type { FactorQuestionContextV1 } from './factor-questions.js';

/**
 * 描述工具调用轨迹的展示单元，供后台轮次与 SSE 客户端共享。
 *
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

/**
 * 聚合单轮执行阶段与工具轨迹，供流式恢复。
 *
 * Collect a turn's phases and tool trace for stream restoration.
 */
export interface AgentTurnTrace {
  version: 1;
  steps: AgentTraceStep[];
  truncated: boolean;
}

/**
 * 定义执行轨迹共享身份与时间，供各步骤变体复用。
 *
 * Define trace identity and timing shared by step variants.
 */
interface AgentTraceBase {
  id: string;
  sequence: number;
  modelCall?: number;
  createdAt: string;
}

/**
 * 区分模型、工具与产物执行步骤，供增量轨迹展示。
 *
 * Discriminate model, tool and artifact steps in incremental traces.
 */
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

/**
 * 返回轮次持久输入、状态与轨迹，供刷新恢复。
 *
 * Return persisted turn input, status and trace for refresh recovery.
 */
export interface AgentTurnDetail {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';
  model: string;
  trace: AgentTurnTrace;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  contextSnapshot?: FactorQuestionContextV1;
}

export type AgentTurnPhase =
  | 'reading_context'
  | 'querying_sdk'
  | 'generating_changes'
  | 'validating_proposal'
  | 'awaiting_review';

/**
 * 定义 SSE 增量、快照与终态事件，供服务端与前端一致消费。
 *
 * Define SSE increment, snapshot and terminal events shared by server and client.
 */
export type AgentStreamEvent =
  | {
      type: 'snapshot';
      text: string;
      trace: ToolTraceItem[];
      reasoning?: string;
      phase?: AgentTurnPhase;
      embeddedAnalyses?: EmbeddedAnalysisPart[];
    }
  | { type: 'delta'; text: string } // produce-phase text tokens (repair rounds don't stream)
  | { type: 'reasoning_delta'; text: string }
  | { type: 'phase'; phase: AgentTurnPhase }
  | { type: 'embedded_analysis'; part: EmbeddedAnalysisPart }
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
