import type { ChartSpec } from './chart.js';
import type { ScreenSpec } from './screen.js';

/**
 * Agent conversation messages (docs/design/unified-agent.md 设计 3). A message is a list of typed
 * parts: text, plus query cards side-produced by the agent's runScreen tool. A card persists the SPEC
 * that produced a result — never the rows — so reopening a conversation re-runs it fresh, and the user
 * can edit the spec or pin it to the card wall (SavedScreen). Artifact code stays OUT of messages
 * (it lives on the strategy/factor row) so conversations stay light.
 *
 * Persisted per host entity (Strategy.messages / Factor.messages / ScreenConversation.messages).
 * Legacy rows persisted `{ role, content }` — normalizeChatMessage upgrades them on read; writes are
 * always the new shape.
 */
export interface TextPart {
  type: 'text';
  text: string;
}

export interface CardPart {
  type: 'card';
  title: string;
  spec: ScreenSpec;
}

/** A chart side-produced by the agent's renderChart tool — persists the query, not the points. */
export interface ChartPart {
  type: 'chart';
  title: string;
  chart: ChartSpec;
}

export type MessagePart = TextPart | CardPart | ChartPart;

export interface ChatMessage {
  role: 'user' | 'assistant';
  parts: MessagePart[];
}

/** Build a plain one-text-part message (the common case for user turns and error bubbles). */
export function textMessage(role: ChatMessage['role'], text: string): ChatMessage {
  return { role, parts: [{ type: 'text', text }] };
}

/** Upgrade a persisted message to the parts shape — tolerates the legacy `{ role, content }` rows. */
export function normalizeChatMessage(raw: unknown): ChatMessage {
  const message = raw as { role?: unknown; content?: unknown; parts?: unknown };
  const role = message?.role === 'assistant' ? 'assistant' : 'user';
  if (Array.isArray(message?.parts)) {
    return { role, parts: message.parts as MessagePart[] };
  }
  return {
    role,
    parts: [{ type: 'text', text: typeof message?.content === 'string' ? message.content : '' }],
  };
}

/** Flatten a message to plain text for LLM context — cards/charts collapse to a short placeholder
 * so the model knows one was shown without re-shipping the spec. */
export function messageText(message: ChatMessage): string {
  return message.parts
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }
      return part.type === 'card' ? `(query card: ${part.title})` : `(chart: ${part.title})`;
    })
    .join('\n')
    .trim();
}
