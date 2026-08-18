import { lazy, Suspense } from 'react';
import type { ChatMessage } from '@jixie/shared';
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
  busyResearchCellChangeId?: string | null;
}

/** One chat message's typed parts (text / query card / chart card) — the single renderer shared by
 * the lab, factor and screen conversation bubbles, so a new part type is added in one place. */
export function MessageParts({
  message,
  onApplyResearchCellChange,
  onRejectResearchCellChange,
  busyResearchCellChangeId,
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
                onApply={onApplyResearchCellChange}
                onReject={onRejectResearchCellChange}
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
