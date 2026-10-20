import {
  withRetainedMarketAccess,
  acquireWorkOwner,
  type MarketLock,
} from '#infra/coordination/market-access.js';
import {
  DEFAULT_LOCALE,
  normalizeChatMessage,
  textMessage,
  type AgentTurnPhase,
  type ChatMessage,
  type Locale,
  type MessagePart,
} from '@jixie/shared';
import { chatTools } from '#infra/llm/deepseek.js';
import { getDeepSeekAgentModel } from '#infra/llm/config.js';
import {
  agentTurn,
  turnParts,
  type AgentProfile,
  type AgentTurnHooks,
  type AgentTurnResult,
} from '../core.js';
import * as turnBus from './bus.js';
import {
  finishPersistentTurn,
  startPersistentTurn,
  persistEmbeddedAnalysisPart,
} from './records.js';
import { AgentTraceRecorder } from './agent-trace-recorder.js';
import { readMessages, writeMessages } from '../conversations/entity-messages.js';
import type { CodeProposalContext } from '../conversations/code-proposals.js';

/**
 * 标识后台 Agent 轮次关联的业务实体，供状态和消息持久化分派。
 *
 * Background agent-turn runner (marginalia's streamRun pattern). The start route registers the turn
 * on the bus + returns the turnId immediately; the turn runs here detached from any HTTP request,
 * publishing incremental events that subscribers (including a refreshed page) receive via SSE.
 *
 * Persistence moves server-side for streamed turns: the USER message is appended to the host
 * entity's messages BEFORE the LLM runs (a refresh mid-turn must show it), and the ASSISTANT
 * message is appended before the `done` event fires (a subscriber acting on `done` can rely on the
 * DB). Factor questions supply an already committed input before background execution starts.
 * Errors/cancels retain already submitted analysis cards without fabricating an assistant answer.
 */
export interface TurnEntity {
  kind: 'strategy' | 'factor' | 'factor-question' | 'research';
  id: string;
}

export function entityKey(entity: TurnEntity): string {
  return `${entity.kind}:${entity.id}`;
}

/**
 * 收集后台轮次启动所需的用户、实体、消息及配置。
 *
 * Supply user, entity, messages and profile information for a background turn.
 */
export interface EnqueueTurnArgs {
  turnId: string;
  ownership?: MarketLock;
  userId: string;
  profile: AgentProfile;
  entity: TurnEntity | null;
  history?: ChatMessage[]; // Nonpersistent callers only; entity turns read history from storage.
  persistedInput?: { history: ChatMessage[]; message: ChatMessage };
  message: string;
  userParts?: MessagePart[];
  currentCode: string;
  codeProposal?: CodeProposalContext;
  locale?: Locale; // the requester's locale — localizes code-generated reply chrome (default zh)
  afterTurn?(result: AgentTurnResult, messages: ChatMessage[]): Promise<void>;
}

/**
 * 同步在事件总线注册后再启动后台执行，使订阅者能够立即接入。
 *
 * Register on the bus synchronously (so subscribers can join right away), then run detached.
 */
export function enqueueAgentTurn(args: EnqueueTurnArgs): void {
  const { signal } = turnBus.start(
    args.turnId,
    args.userId,
    args.entity ? entityKey(args.entity) : null,
  );
  if (args.entity?.kind === 'research') {
    turnBus.publish(args.turnId, { type: 'phase', phase: 'reading_context' });
  }
  void withRetainedMarketAccess(async () => {
    const owner = args.ownership ?? (await acquireWorkOwner('agent', args.turnId));
    try {
      await runTurn(args, signal);
    } finally {
      await owner.release();
    }
  }).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const recorder = new AgentTraceRecorder(args.turnId, getDeepSeekAgentModel());
    recorder.terminal('error', message);
    await finishPersistentTurn({
      turnId: args.turnId,
      status: 'error',
      error: message,
      trace: recorder.trace,
    }).catch(() => {});
    turnBus.finish(args.turnId, { type: 'error', message });
  });
}

/**
 * 编排后台模型执行、流式事件与消息持久化，并统一处理成功、取消和错误终态。
 *
 * Coordinate model execution, stream events and message persistence across success, cancellation and failure.
 */
async function runTurn(args: EnqueueTurnArgs, signal: AbortSignal): Promise<void> {
  const { turnId, userId, entity, message, currentCode, profile } = args;
  const locale = args.locale ?? DEFAULT_LOCALE;
  const model = getDeepSeekAgentModel();
  let researchPhase: AgentTurnPhase | null = entity?.kind === 'research' ? 'reading_context' : null;
  let traceRecorder: AgentTraceRecorder | null = args.persistedInput
    ? new AgentTraceRecorder(turnId, model)
    : null;

  const publishResearchPhase = (phase: AgentTurnPhase): void => {
    if (
      entity?.kind !== 'research' ||
      researchPhase === phase ||
      researchPhase === 'awaiting_review'
    ) {
      return;
    }
    researchPhase = phase;
    turnBus.publish(turnId, { type: 'phase', phase });
  };

  try {
    // History + user-message persistence (entity surfaces). The write happens before the LLM runs.
    let history: ChatMessage[] = args.history ?? [];
    let persisted: ChatMessage[] | null = null;
    if (args.persistedInput) {
      history = args.persistedInput.history;
      persisted = [...history, args.persistedInput.message];
    } else if (entity) {
      const stored = await readMessages(entity, userId, locale);
      history = stored.map(normalizeChatMessage);
      const userParts = args.userParts ?? textMessage('user', message).parts;
      await startPersistentTurn({
        turnId,
        userId,
        entity,
        history,
        message,
        model,
        userParts,
      });
      traceRecorder = new AgentTraceRecorder(turnId, model);
      persisted = [...history, { role: 'user', parts: userParts, turnId }];
      await writeMessages(entity, persisted);
    }

    const hooks: AgentTurnHooks = {
      onEmbeddedAnalysis: async (part) => {
        const parts = await persistEmbeddedAnalysisPart(turnId, part);
        if (entity && persisted) {
          await writeMessages(entity, [...persisted, { role: 'assistant', parts, turnId }]);
        }
        turnBus.publish(turnId, { type: 'embedded_analysis', part });
      },
      signal,
      onDelta: (text) => {
        publishResearchPhase('generating_changes');
        turnBus.publish(turnId, { type: 'delta', text });
      },
      onReasoningDelta: (modelCall, text) => {
        traceRecorder?.reasoningDelta(modelCall, text);
        turnBus.publish(turnId, { type: 'reasoning_delta', text });
      },
      onModelStart: (modelCall, toolsEnabled) => traceRecorder?.modelStart(modelCall, toolsEnabled),
      onModelDone: (modelCall) => traceRecorder?.modelDone(modelCall),
      onToolStart: (name, argsSummary) => {
        turnBus.publish(turnId, { type: 'tool_start', name, argsSummary });
        if (name === 'searchResearchCatalog') {
          publishResearchPhase('querying_sdk');
        } else if (name === 'proposeResearchCellChanges') {
          publishResearchPhase('validating_proposal');
        }
      },
      onToolDone: (item, detail) => {
        traceRecorder?.tool({
          ...detail,
          name: item.name,
          ok: item.ok,
          rows: item.rows,
          durationMs: item.ms,
        });
        turnBus.publish(turnId, { type: 'tool_done', item });
        if (
          (item.name === 'proposeResearchCellChanges' ||
            item.name === 'requestResearchClarification') &&
          item.ok
        ) {
          publishResearchPhase('awaiting_review');
        } else if (entity?.kind === 'research') {
          publishResearchPhase('generating_changes');
        }
      },
      onRepair: (round, error) => turnBus.publish(turnId, { type: 'repair', round, error }),
      onValidation: (round, ok, durationMs, error) =>
        traceRecorder?.validation(round, ok, durationMs, error),
    };
    const result = await agentTurn(profile, history, message, currentCode, chatTools, {
      hooks,
      locale,
    });

    // Persist the assistant message BEFORE `done` fires — a subscriber reacting to done (or a
    // refresh racing it) must find the conversation complete in the DB.
    const parts = turnParts(result);
    let completedParts = parts;
    if (traceRecorder) {
      await traceRecorder.flush();
      completedParts =
        (await finishPersistentTurn({
          turnId,
          status: 'done',
          ...(args.codeProposal && result.changed && result.code !== currentCode
            ? { codeChange: { ...args.codeProposal, afterCode: result.code } }
            : {}),
          parts,
          trace: traceRecorder.trace,
        })) ?? parts;
    }
    const completedMessages = persisted
      ? [...persisted, { role: 'assistant' as const, parts: completedParts, turnId }]
      : [];
    if (entity && persisted) {
      await writeMessages(entity, completedMessages);
    }
    turnBus.finish(turnId, {
      type: 'done',
      parts: completedParts,
      // 待审代码只随持久化产物返回，旧客户端也不能根据终态自动覆盖源码。
      // Proposed code travels only in durable parts; legacy clients cannot auto-apply terminal code.
      code: args.codeProposal ? currentCode : result.code,
      changed: args.codeProposal ? false : result.changed,
      attempts: result.attempts,
      toolTrace: result.toolTrace,
      ...(result.error ? { error: result.error } : {}),
    });

    // 终态事件已发送，但后续写入仍属于本轮读锁范围。
    // The terminal event is sent, but follow-up writes still belong to this reader scope.
    if (args.afterTurn) {
      await args.afterTurn(result, completedMessages).catch((error) => {
        console.error(`[agent] after-turn hook failed (turnId=${turnId})`, error);
      });
    }
  } catch (error) {
    const cancelled = signal.aborted;
    if (!cancelled) {
      // The frontend only gets the message — without this line a provider timeout/401/limit is unguessable.
      console.error(`[agent] turn failed (turnId=${turnId})`, error);
    }
    if (traceRecorder) {
      const message = error instanceof Error ? error.message : String(error);
      traceRecorder.terminal(cancelled ? 'cancelled' : 'error', cancelled ? undefined : message);
      await traceRecorder.flush().catch(() => {});
      await finishPersistentTurn({
        turnId,
        status: cancelled ? 'cancelled' : 'error',
        error: cancelled ? undefined : message,
        trace: traceRecorder.trace,
      }).catch((persistenceError) => {
        console.error(
          `[agent] failed to persist terminal turn (turnId=${turnId})`,
          persistenceError,
        );
      });
    }
    turnBus.finish(
      turnId,
      cancelled
        ? { type: 'cancelled' }
        : { type: 'error', message: error instanceof Error ? error.message : String(error) },
    );
  }
}
