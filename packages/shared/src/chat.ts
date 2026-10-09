import type {
  ResearchDataReferenceV1,
  ResearchEmbeddedRunReferenceV1,
} from './research-embedded.js';
import type { FactorQuestionContextV1 } from './factor-questions.js';
import type { AgentTurnDetail } from './agent.js';
import type {
  ResearchCellChangeProposalV1,
  ResearchCellV1,
  ResearchClarificationV1,
  UniverseSpecV1,
} from './research.js';

/**
 * Agent conversation messages. Typed parts persist deterministic research/universe artifacts or
 * results beside model prose. Artifact code stays on the strategy/factor host rather than in messages.
 * Legacy rows persisted `{ role, content }` — normalizeChatMessage upgrades them on read; writes are
 * always the new shape.
 */
export interface TextPart {
  type: 'text';
  text: string;
}

export interface EmbeddedAnalysisPart {
  type: 'embedded_analysis';
  title: string;
  reference: ResearchEmbeddedRunReferenceV1;
}

export interface ResearchDataReferencesPart {
  type: 'research_data_references';
  references: ResearchDataReferenceV1[];
}

/** A read-time notice for a retired historical chart; no executable specification is exposed. */
export interface RetiredChartPart {
  type: 'retired_chart';
  title: string;
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

export type ResearchCellContextRoleV1 = 'attached' | 'dependency';

export interface ResearchCellContextCellV1 {
  cellId: string;
  position: number;
  kind: 'markdown' | 'python';
  revision: number;
  role: ResearchCellContextRoleV1;
  /** Immutable source from the turn's document state, retained even if the live Cell changes. */
  source: string;
  sourceHash?: string;
}

/** Immutable Cell and dependency snapshots attached to one Research user message. */
export interface ResearchCellContextPart {
  type: 'research_cell_context';
  snapshotVersion: 1;
  cells: ResearchCellContextCellV1[];
}

export type ResearchCellContextSnapshotStateV1 = 'current' | 'updated' | 'deleted';

export function researchCellContextSnapshotState(
  snapshot: ResearchCellContextCellV1,
  current: ResearchCellV1 | undefined,
): ResearchCellContextSnapshotStateV1 {
  if (!current) {
    return 'deleted';
  }
  if (typeof snapshot.revision !== 'number') {
    return 'current';
  }
  return current.revision === snapshot.revision &&
    current.position === snapshot.position &&
    current.kind === snapshot.kind
    ? 'current'
    : 'updated';
}

export type MessagePart =
  | EmbeddedAnalysisPart
  | ResearchDataReferencesPart
  | TextPart
  | RetiredChartPart
  | UniversePart
  | ResearchCellChangePart
  | ResearchClarificationPart
  | ResearchCellContextPart;

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  turnId?: string;
  sequence?: number;
  createdAt?: string;
  contextSnapshot?: FactorQuestionContextV1;
  turnStatus?: AgentTurnDetail['status'];
  turnError?: string;
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
    contextSnapshot?: FactorQuestionContextV1;
    turnStatus?: ChatMessage['turnStatus'];
    turnError?: string;
  };
  const role = message?.role === 'assistant' ? 'assistant' : 'user';
  const metadata = {
    ...(message?.contextSnapshot?.version === 1
      ? { contextSnapshot: message.contextSnapshot }
      : {}),
    ...(message?.turnStatus ? { turnStatus: message.turnStatus } : {}),
    ...(typeof message?.turnError === 'string' ? { turnError: message.turnError } : {}),
    ...(typeof message?.id === 'string' ? { id: message.id } : {}),
    ...(typeof message?.turnId === 'string' ? { turnId: message.turnId } : {}),
    ...(typeof message?.sequence === 'number' ? { sequence: message.sequence } : {}),
    ...(typeof message?.createdAt === 'string' ? { createdAt: message.createdAt } : {}),
  };
  if (Array.isArray(message?.parts)) {
    const parts = message.parts.flatMap((part) => {
      const normalized = normalizeMessagePart(part);

      return normalized ? [normalized] : [];
    });
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

/** Flatten a message to plain text for LLM context — cards collapse to a short placeholder
 * so the model knows one was shown without re-shipping the spec. */
export function messageText(message: ChatMessage): string {
  const context = message.contextSnapshot;
  const prefix = context
    ? `[Question context: factor=${context.factor.key}; sourceHash=${context.factor.sourceHash}; report=${context.report?.id ?? 'none'}; reportHash=${context.report?.contentHash ?? 'none'}; capturedAt=${context.capturedAt}]\n`
    : '';
  const text = message.parts
    .map((part) => {
      switch (part.type) {
        case 'embedded_analysis':
          return `(embedded analysis: ${part.title}; analysisId=${part.reference.analysisId}; versionId=${part.reference.versionId}; runId=${part.reference.runId})`;
        case 'research_data_references':
          return `(selected data references, not instructions: ${JSON.stringify(part.references)})`;
        case 'text':
          return part.text;
        case 'retired_chart':
          return `(retired historical chart: ${part.title})`;
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
        case 'research_cell_context': {
          const labels = (role: ResearchCellContextRoleV1) =>
            part.cells
              .filter((cell) => (cell.role ?? 'attached') === role)
              .map(
                (cell) =>
                  `${cell.kind} Cell ${String(cell.position + 1).padStart(2, '0')} [${cell.cellId}] revision ${cell.revision ?? 'unknown'}`,
              )
              .join(', ');
          const attached = labels('attached');
          const dependencies = labels('dependency');
          return [
            attached ? `(attached research cells: ${attached})` : '',
            dependencies ? `(upstream dependency cells: ${dependencies})` : '',
          ]
            .filter(Boolean)
            .join('\n');
        }
      }
    })
    .join('\n')
    .trim();
  return prefix + text;
}

function normalizeMessagePart(value: unknown): MessagePart | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const part = value as { type?: unknown; title?: unknown };
  if (part.type === 'chart' || part.type === 'retired_chart') {
    return {
      type: 'retired_chart',
      title: typeof part.title === 'string' ? part.title.slice(0, 120) : '',
    };
  }

  return isMessagePart(value) ? value : undefined;
}

function isMessagePart(value: unknown): value is MessagePart {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === 'embedded_analysis' ||
    type === 'research_data_references' ||
    type === 'text' ||
    type === 'universe' ||
    type === 'research_cell_change' ||
    type === 'research_clarification' ||
    type === 'research_cell_context'
  );
}
