import type { ResearchDataReferenceV1, MessagePart } from '@jixie/shared';

export function embeddedUserParts(
  message: string,
  references: ResearchDataReferenceV1[],
): MessagePart[] {
  return [
    { type: 'text', text: message },
    ...(references.length ? [{ type: 'research_data_references' as const, references }] : []),
  ];
}
