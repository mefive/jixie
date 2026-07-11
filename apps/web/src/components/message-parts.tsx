import { lazy, Suspense } from 'react';
import type { ChatMessage } from '@jixie/shared';
import { Markdown } from './markdown';
import { QueryCard } from './query-card';
import type { QueryCardResults } from './query-card-model';
// Imported here (not only by the lazy chunk) so the Suspense fallback below has its height class
// available before chat-chart.tsx lands — the placeholder must match the card's footprint.
import './chat-chart.css';

const ChatChart = lazy(() => import('./chat-chart'));

interface MessagePartsProps {
  message: ChatMessage;
  cards: QueryCardResults;
  onQueryPinned?: () => void;
}

/** One chat message's typed parts (text / query card / chart card) — the single renderer shared by
 * the lab, factor and screen conversation bubbles, so a new part type is added in one place. */
export function MessageParts({ message, cards, onQueryPinned }: MessagePartsProps) {
  return (
    <>
      {message.parts.map((part, partIndex) => {
        if (part.type === 'card') {
          return (
            <QueryCard
              key={partIndex}
              title={part.title}
              spec={part.spec}
              results={cards}
              onPinned={onQueryPinned}
            />
          );
        }
        if (part.type === 'chart') {
          return (
            <Suspense key={partIndex} fallback={<div className="jx-chatChart--pending" />}>
              <ChatChart title={part.title} chart={part.chart} />
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
