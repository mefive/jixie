import type { ChatMessage, EmbeddedAnalysisPart, ResearchDataReferenceV1 } from '@jixie/shared';

export function embeddedUserMessage(
  text: string,
  references: ResearchDataReferenceV1[],
): ChatMessage {
  return {
    role: 'user',
    parts: [
      { type: 'text', text },
      ...(references.length ? [{ type: 'research_data_references' as const, references }] : []),
    ],
  };
}

export function upsertAssistantMessage(
  messages: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const index = messages.findIndex(
    (item) => item.role === 'assistant' && item.turnId === message.turnId,
  );
  if (index < 0) {
    return [...messages, message];
  }
  return messages.map((item, position) => (position === index ? { ...item, ...message } : item));
}

export function retainEmbeddedPart(
  messages: ChatMessage[],
  part: EmbeddedAnalysisPart,
  turnId: string,
): ChatMessage[] {
  const existing = messages.find((item) => item.role === 'assistant' && item.turnId === turnId);
  if (
    existing?.parts.some(
      (item) => item.type === 'embedded_analysis' && item.reference.runId === part.reference.runId,
    )
  ) {
    return messages;
  }
  return upsertAssistantMessage(messages, {
    ...existing,
    role: 'assistant',
    turnId,
    parts: [...(existing?.parts ?? []), part],
  });
}
