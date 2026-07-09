import type { Prisma } from '@prisma/client';
import {
  DEFAULT_LOCALE,
  normalizeChatMessage,
  textMessage,
  type ChatMessage,
  type Locale,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { chatTools } from '../llm/deepseek.js';
import { t } from '../i18n/index.js';
import { agentTurn, turnParts, type AgentProfile, type AgentTurnHooks } from './core.js';
import * as turnBus from './turn-bus.js';

/**
 * Background agent-turn runner (marginalia's streamRun pattern). The start route registers the turn
 * on the bus + returns the turnId immediately; the turn runs here detached from any HTTP request,
 * publishing incremental events that subscribers (including a refreshed page) receive via SSE.
 *
 * Persistence moves server-side for streamed turns: the USER message is appended to the host
 * entity's messages BEFORE the LLM runs (a refresh mid-turn must show it), and the ASSISTANT
 * message is appended before the `done` event fires (a subscriber acting on `done` can rely on the
 * DB). Ephemeral surfaces (preset-factor QA) pass entity=null + their own history — nothing persists.
 * Errors/cancels persist no assistant message: a user message without a reply is the honest record.
 */
export interface TurnEntity {
  kind: 'strategy' | 'factor' | 'screen';
  id: string;
}

export function entityKey(entity: TurnEntity): string {
  return `${entity.kind}:${entity.id}`;
}

export interface EnqueueTurnArgs {
  turnId: string;
  userId: string;
  profile: AgentProfile;
  entity: TurnEntity | null;
  history?: ChatMessage[]; // entity=null (QA) only; entity turns read history from the DB row
  message: string;
  currentCode: string;
  locale?: Locale; // the requester's locale — localizes code-generated reply chrome (default zh)
}

/** Register on the bus synchronously (so subscribers can join right away), then run detached. */
export function enqueueAgentTurn(args: EnqueueTurnArgs): void {
  const { signal } = turnBus.start(
    args.turnId,
    args.userId,
    args.entity ? entityKey(args.entity) : null,
  );
  void runTurn(args, signal);
}

async function runTurn(args: EnqueueTurnArgs, signal: AbortSignal): Promise<void> {
  const { turnId, userId, entity, message, currentCode, profile } = args;
  const locale = args.locale ?? DEFAULT_LOCALE;
  try {
    // History + user-message persistence (entity surfaces). The write happens before the LLM runs.
    let history: ChatMessage[] = args.history ?? [];
    let persisted: ChatMessage[] | null = null;
    if (entity) {
      const stored = await readMessages(entity, userId, locale);
      history = stored.map(normalizeChatMessage);
      persisted = [...history, textMessage('user', message)];
      await writeMessages(entity, persisted);
    }

    const hooks: AgentTurnHooks = {
      signal,
      onDelta: (text) => turnBus.publish(turnId, { type: 'delta', text }),
      onToolStart: (name, argsSummary) =>
        turnBus.publish(turnId, { type: 'tool_start', name, argsSummary }),
      onToolDone: (item) => turnBus.publish(turnId, { type: 'tool_done', item }),
      onRepair: (round, error) => turnBus.publish(turnId, { type: 'repair', round, error }),
    };
    const result = await agentTurn(profile, history, message, currentCode, chatTools, {
      hooks,
      locale,
    });

    // Persist the assistant message BEFORE `done` fires — a subscriber reacting to done (or a
    // refresh racing it) must find the conversation complete in the DB.
    const parts = turnParts(result);
    if (entity && persisted) {
      await writeMessages(entity, [...persisted, { role: 'assistant', parts }]);
    }
    turnBus.finish(turnId, {
      type: 'done',
      parts,
      code: result.code,
      changed: result.changed,
      attempts: result.attempts,
      toolTrace: result.toolTrace,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (error) {
    const cancelled = signal.aborted;
    if (!cancelled) {
      // The frontend only gets the message — without this line a provider timeout/401/limit is unguessable.
      console.error(`[agent] turn failed (turnId=${turnId})`, error);
    }
    turnBus.finish(
      turnId,
      cancelled
        ? { type: 'cancelled' }
        : { type: 'error', message: error instanceof Error ? error.message : String(error) },
    );
  }
}

// —— entity messages IO ——

async function readMessages(
  entity: TurnEntity,
  userId: string,
  locale: Locale,
): Promise<unknown[]> {
  const where = { id: entity.id, userId };

  // Exhaustive switch: a new entity kind leaves `row` unassigned and fails the build.
  let row: { messages: Prisma.JsonValue } | null;
  switch (entity.kind) {
    case 'strategy':
      row = await prisma.strategy.findFirst({ where, select: { messages: true } });
      break;
    case 'factor':
      row = await prisma.factor.findFirst({ where, select: { messages: true } });
      break;
    case 'screen':
      row = await prisma.screenConversation.findFirst({ where, select: { messages: true } });
      break;
  }

  if (!row) {
    throw new Error(t(locale, 'turnHostGone'));
  }
  return Array.isArray(row.messages) ? (row.messages as unknown[]) : [];
}

async function writeMessages(entity: TurnEntity, messages: ChatMessage[]): Promise<void> {
  const data = { messages: messages as unknown as Prisma.InputJsonValue };

  switch (entity.kind) {
    case 'strategy':
      await prisma.strategy.update({ where: { id: entity.id }, data });
      break;
    case 'factor':
      await prisma.factor.update({ where: { id: entity.id }, data });
      break;
    case 'screen':
      await prisma.screenConversation.update({ where: { id: entity.id }, data });
      break;
    default:
      entity.kind satisfies never; // compile error when a new kind is added but unhandled
  }
}
