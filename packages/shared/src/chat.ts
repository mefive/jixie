import type { ChartSpec } from './chart.js';
import type {
  ResearchCellChangeProposalV1,
  ResearchClarificationV1,
  UniverseSpecV1,
} from './research.js';

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

/** A deterministic entity universe. Legacy saved screens migrate to this typed Research artifact. */
export interface UniversePart {
  type: 'universe';
  title: string;
  spec: UniverseSpecV1;
}

/** A durable Agent-authored Cell change proposal. Applying it remains an explicit user action. */
export interface ResearchCellChangePart {
  type: 'research_cell_change';
  proposal: ResearchCellChangeProposalV1;
}

/** A durable, document-bound question that pauses semantic substitution until the user answers. */
export interface ResearchClarificationPart {
  type: 'research_clarification';
  clarification: ResearchClarificationV1;
}

export type MessagePart =
  | TextPart
  | ChartPart
  | UniversePart
  | ResearchCellChangePart
  | ResearchClarificationPart;

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
    const parts = message.parts.filter(isMessagePart);
    return {
      role,
      parts: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
      ...metadata,
    };
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
      switch (part.type) {
        case 'text':
          return part.text;
        case 'chart':
          return `(chart: ${part.title})`;
        case 'universe':
          return `(research universe: ${part.title}, predicates=${part.spec.predicates.length})`;
        case 'research_cell_change':
          return `(research cell change proposal: ${part.proposal.title}, status=${part.proposal.status}, operations=${part.proposal.operations.length})`;
        case 'research_clarification': {
          const selections = part.clarification.answer?.selections
            .map((selection) => {
              const question = part.clarification.questions.find(
                (candidate) => candidate.id === selection.questionId,
              );
              const references = selection.selectedOptionIds.flatMap((optionId) => {
                const option = question?.options.find((candidate) => candidate.id === optionId);
                return option?.referenceId ? [`${option.kind}:${option.referenceId}`] : [optionId];
              });
              return `${selection.questionId}=${references.join(',')}${selection.customText ? `;custom=${selection.customText}` : ''}`;
            })
            .join(' | ');
          return `(research clarification: ${part.clarification.title}, status=${part.clarification.status}${selections ? `, answer=${selections}` : ''})`;
        }
      }
    })
    .join('\n')
    .trim();
}

function isMessagePart(value: unknown): value is MessagePart {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === 'text' ||
    type === 'chart' ||
    type === 'universe' ||
    type === 'research_cell_change' ||
    type === 'research_clarification'
  );
}
