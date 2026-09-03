import { lazy, Suspense } from 'react';
import type {
  ChatMessage,
  ResearchCellChangeAttemptV1,
  ResearchCellContextCellV1,
  ResearchCellV1,
  ResearchClarificationSelectionV1,
  ResearchClarificationV1,
} from '@jixie/shared';
import { researchCellContextSnapshotState } from '@jixie/shared';
import {
  faClockRotateLeft,
  faDiagramProject,
  faPaperclip,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { Markdown } from './markdown';
import { UniverseSpecCard } from './universe-spec-card';
// Imported here (not only by the lazy chunk) so the Suspense fallback below has its height class
// available before chat-chart.tsx lands — the placeholder must match the card's footprint.
import './chat-chart.css';
import './message-parts.css';

const ChatChart = lazy(() => import('./chat-chart'));
const ResearchCellChangeCard = lazy(() => import('./research-cell-change-card'));
const ResearchClarificationCard = lazy(() => import('./research-clarification-card'));

interface MessagePartsProps {
  message: ChatMessage;
  onApplyResearchCellChange?: (proposalId: string) => Promise<void>;
  onRejectResearchCellChange?: (proposalId: string) => Promise<void>;
  onAcceptResearchCellChangeReview?: (proposalId: string) => Promise<void>;
  onRevertResearchCellChangeReview?: (proposalId: string) => Promise<void>;
  onRunResearchCellChange?: (proposalId: string) => Promise<void>;
  onExplainResearchCellChangeAttempt?: (attempt: ResearchCellChangeAttemptV1) => Promise<void>;
  busyResearchCellChangeId?: string | null;
  busyResearchCellChangeRunId?: string | null;
  busyResearchCellChangeExplanationId?: string | null;
  researchCellChangeAttempts?: ResearchCellChangeAttemptV1[];
  researchDocumentContentRevision?: number;
  onAnswerResearchClarification?: (
    clarification: ResearchClarificationV1,
    selections: ResearchClarificationSelectionV1[],
  ) => Promise<void>;
  busyResearchClarificationId?: string | null;
  researchCells?: ResearchCellV1[];
  onNavigateResearchCellContext?: (cellId: string) => void;
  onOpenResearchCellContextSnapshot?: (cell: ResearchCellContextCellV1) => void;
}

/** One chat message's typed parts (text / query card / chart card) — the single renderer shared by
 * the lab, factor and screen conversation bubbles, so a new part type is added in one place. */
export function MessageParts({
  message,
  onApplyResearchCellChange,
  onRejectResearchCellChange,
  onAcceptResearchCellChangeReview,
  onRevertResearchCellChangeReview,
  onRunResearchCellChange,
  onExplainResearchCellChangeAttempt,
  busyResearchCellChangeId,
  busyResearchCellChangeRunId,
  busyResearchCellChangeExplanationId,
  researchCellChangeAttempts = [],
  researchDocumentContentRevision,
  onAnswerResearchClarification,
  busyResearchClarificationId,
  researchCells = [],
  onNavigateResearchCellContext,
  onOpenResearchCellContextSnapshot,
}: MessagePartsProps) {
  return (
    <>
      {message.parts.map((part, partIndex) => {
        if (part.type === 'chart') {
          return (
            <Suspense key={partIndex} fallback={<div className="jx-chatChart--pending" />}>
              <ChatChart title={part.title} chart={part.chart} />
            </Suspense>
          );
        }
        if (part.type === 'universe') {
          return <UniverseSpecCard key={partIndex} part={part} />;
        }
        if (part.type === 'research_cell_change') {
          return (
            <Suspense key={`${partIndex}-${part.proposal.id}`} fallback={null}>
              <ResearchCellChangeCard
                proposal={part.proposal}
                busy={busyResearchCellChangeId === part.proposal.id}
                runBusy={busyResearchCellChangeRunId === part.proposal.id}
                explanationBusyId={busyResearchCellChangeExplanationId}
                attempts={researchCellChangeAttempts.filter(
                  (attempt) => attempt.proposalId === part.proposal.id,
                )}
                documentContentRevision={researchDocumentContentRevision}
                onApply={onApplyResearchCellChange}
                onReject={onRejectResearchCellChange}
                onAcceptReview={onAcceptResearchCellChangeReview}
                onRevertReview={onRevertResearchCellChangeReview}
                onRun={onRunResearchCellChange}
                onExplain={onExplainResearchCellChangeAttempt}
              />
            </Suspense>
          );
        }
        if (part.type === 'research_clarification') {
          return (
            <Suspense key={`${partIndex}-${part.clarification.id}`} fallback={null}>
              <ResearchClarificationCard
                clarification={part.clarification}
                busy={busyResearchClarificationId === part.clarification.id}
                onAnswer={onAnswerResearchClarification}
              />
            </Suspense>
          );
        }
        if (part.type === 'research_cell_context') {
          return (
            <ResearchCellContextChips
              key={partIndex}
              cells={part.cells}
              researchCells={researchCells}
              onNavigate={onNavigateResearchCellContext}
              onOpenSnapshot={onOpenResearchCellContextSnapshot}
            />
          );
        }
        return message.role === 'assistant' ? (
          <Markdown key={partIndex} text={part.text} />
        ) : (
          <span key={partIndex}>{part.text}</span>
        );
      })}
    </>
  );
}

function ResearchCellContextChips({
  cells,
  researchCells,
  onNavigate,
  onOpenSnapshot,
}: {
  cells: ResearchCellContextCellV1[];
  researchCells: ResearchCellV1[];
  onNavigate?: (cellId: string) => void;
  onOpenSnapshot?: (cell: ResearchCellContextCellV1) => void;
}) {
  const { t } = useTranslation('research');
  const currentCellById = new Map(researchCells.map((cell) => [cell.id, cell]));
  return (
    <div className="jx-messageParts-cellContext">
      {cells.map((cell) => {
        const currentCell = currentCellById.get(cell.cellId);
        const state = researchCellContextSnapshotState(cell, currentCell);
        const hasSnapshot = typeof cell.source === 'string';
        const canNavigate = Boolean(currentCell && onNavigate);
        const canOpenSnapshot = Boolean(hasSnapshot && onOpenSnapshot);
        const action = () => {
          if (state === 'current' && canNavigate) {
            onNavigate?.(cell.cellId);
          } else if (canOpenSnapshot) {
            onOpenSnapshot?.(cell);
          } else if (canNavigate) {
            onNavigate?.(cell.cellId);
          }
        };
        const labelKey =
          (cell.role ?? 'attached') === 'dependency'
            ? 'workbench.agentCellContext.dependencyLabel'
            : 'workbench.agentCellContext.label';
        return (
          <Tooltip
            key={`${cell.role ?? 'attached'}:${cell.cellId}`}
            title={t(`workbench.agentCellContext.action.${state}`)}
          >
            <Button
              type="text"
              size="small"
              className={`jx-messageParts-cellContextChip jx-messageParts-cellContextChip--${state}`}
              data-testid={`research-message-context-${cell.cellId}`}
              disabled={!canNavigate && !canOpenSnapshot}
              icon={
                <FontAwesomeIcon
                  icon={
                    state === 'deleted'
                      ? faTrash
                      : state === 'updated'
                        ? faClockRotateLeft
                        : (cell.role ?? 'attached') === 'dependency'
                          ? faDiagramProject
                          : faPaperclip
                  }
                />
              }
              onClick={action}
            >
              {t(labelKey, {
                ordinal: String(cell.position + 1).padStart(2, '0'),
                kind: t(`workbench.cellKind.${cell.kind}`),
              })}
              {state !== 'current' && (
                <span className="jx-messageParts-cellContextState">
                  {t(`workbench.agentCellContext.state.${state}`)}
                </span>
              )}
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
}
