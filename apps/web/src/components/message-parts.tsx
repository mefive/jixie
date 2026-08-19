import { lazy, Suspense } from 'react';
import type { ChatMessage, ResearchCellChangeAttemptV1 } from '@jixie/shared';
import { Markdown } from './markdown';
import { UniverseSpecCard } from './universe-spec-card';
// Imported here (not only by the lazy chunk) so the Suspense fallback below has its height class
// available before chat-chart.tsx lands — the placeholder must match the card's footprint.
import './chat-chart.css';

const ChatChart = lazy(() => import('./chat-chart'));
const ResearchResultCard = lazy(() =>
  import('./research-result-card').then((module) => ({ default: module.ResearchResultCard })),
);
const ResearchCellChangeCard = lazy(() => import('./research-cell-change-card'));

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
        if (part.type === 'research') {
          return (
            <Suspense
              key={`${partIndex}-${part.record?.runId ?? part.title}`}
              fallback={<div className="jx-chatChart--pending" />}
            >
              <ResearchResultCard part={part} />
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
        return message.role === 'assistant' ? (
          <Markdown key={partIndex} text={part.text} />
        ) : (
          <span key={partIndex}>{part.text}</span>
        );
      })}
    </>
  );
}
