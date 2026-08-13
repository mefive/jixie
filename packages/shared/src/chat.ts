import type { ChartSpec } from './chart.js';
import type { ResearchRunResultV1, UniverseSpecV1 } from './research.js';

/**
 * Agent conversation messages. Typed parts persist the deterministic chart/research/universe spec or
 * result beside model prose. Artifact code stays on the strategy/factor host rather than in messages.
 * Legacy rows persisted `{ role, content }` — normalizeChatMessage upgrades them on read; writes are
 * always the new shape.
 */
export interface TextPart {
  type: 'text';
  text: string;
}

/** A chart side-produced by the agent's renderChart tool — persists the query, not the points. */
export interface ChartPart {
  type: 'chart';
  title: string;
  chart: ChartSpec;
}

/** A deterministic ResearchPlan execution. The model writes the adjacent explanation, not this payload. */
export interface ResearchPart {
  type: 'research';
  title: string;
  run: ResearchRunResultV1;
}

/** A deterministic entity universe. Legacy saved screens migrate to this typed Research artifact. */
export interface UniversePart {
  type: 'universe';
  title: string;
  spec: UniverseSpecV1;
}

export type MessagePart = TextPart | ChartPart | ResearchPart | UniversePart;

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  turnId?: string;
  sequence?: number;
  createdAt?: string;
}

/** Build a plain one-text-part message (the common case for user turns and error bubbles). */
export function textMessage(role: ChatMessage['role'], text: string): ChatMessage {
  return { role, parts: [{ type: 'text', text }] };
}

/** Upgrade a persisted message to the parts shape — tolerates the legacy `{ role, content }` rows. */
export function normalizeChatMessage(raw: unknown): ChatMessage {
  const message = raw as {
    id?: unknown;
    role?: unknown;
    content?: unknown;
    parts?: unknown;
    turnId?: unknown;
    sequence?: unknown;
    createdAt?: unknown;
  };
  const role = message?.role === 'assistant' ? 'assistant' : 'user';
  const metadata = {
    ...(typeof message?.id === 'string' ? { id: message.id } : {}),
    ...(typeof message?.turnId === 'string' ? { turnId: message.turnId } : {}),
    ...(typeof message?.sequence === 'number' ? { sequence: message.sequence } : {}),
    ...(typeof message?.createdAt === 'string' ? { createdAt: message.createdAt } : {}),
  };
  if (Array.isArray(message?.parts)) {
    return { role, parts: message.parts as MessagePart[], ...metadata };
  }
  return {
    role,
    parts: [{ type: 'text', text: typeof message?.content === 'string' ? message.content : '' }],
    ...metadata,
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
      if (part.type === 'chart') {
        return `(chart: ${part.title})`;
      }
      if (part.type === 'universe') {
        return `(research universe: ${part.title}, predicates=${part.spec.predicates.length})`;
      }
      return `(research result: ${part.title}, protocol=${part.run.protocol.id}, observations=${part.run.result.observations})`;
    })
    .join('\n')
    .trim();
}
