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

interface MessagePartsProps {
  message: ChatMessage;
}

/** One chat message's typed parts (text / query card / chart card) — the single renderer shared by
 * the lab, factor and screen conversation bubbles, so a new part type is added in one place. */
export function MessageParts({ message }: MessagePartsProps) {
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
            <Suspense key={partIndex} fallback={<div className="jx-chatChart--pending" />}>
              <ResearchResultCard part={part} />
            </Suspense>
          );
        }
        if (part.type === 'universe') {
          return <UniverseSpecCard key={partIndex} part={part} />;
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
