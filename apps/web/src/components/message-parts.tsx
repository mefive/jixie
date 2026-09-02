import { lazy, Suspense } from 'react';
import type {
  ChatMessage,
  ResearchCellChangeAttemptV1,
  ResearchClarificationSelectionV1,
  ResearchClarificationV1,
} from '@jixie/shared';
import { faPaperclip } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
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
}: MessagePartsProps) {
  const { t } = useTranslation('research');
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
            <div key={partIndex} className="jx-messageParts-cellContext">
              <FontAwesomeIcon icon={faPaperclip} />
              {part.cells.map((cell) => (
                <span key={cell.cellId}>
                  {t('workbench.agentCellContext.label', {
                    ordinal: String(cell.position + 1).padStart(2, '0'),
                    kind: t(`workbench.cellKind.${cell.kind}`),
                  })}
                </span>
              ))}
            </div>
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
