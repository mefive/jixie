import { z } from 'zod';
import type { ResearchDataReferenceV1, MessagePart } from '@jixie/shared';
import { researchExecutionFrameSchema } from '../sdk/protocol.js';
import { parseResearchRequestFrame } from '../sdk/dispatch.js';

export const embeddedDataReferencesSchema = z
  .array(
    z
      .strictObject({
        label: z.string().trim().min(1).max(160),
        method: z.string().min(1).max(100),
        arguments: z.record(z.string(), z.unknown()),
      })
      .superRefine((reference, context) => {
        try {
          const frame = researchExecutionFrameSchema.parse({
            type: 'request',
            id: 1,
            method: reference.method,
            arguments: reference.arguments,
          });
          if (frame.type === 'request') {
            parseResearchRequestFrame(frame);
          }
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
  )
  .max(8)
  .refine(
    (references) => Buffer.byteLength(JSON.stringify(references)) <= 16_384,
    'Selected data references exceed 16 KiB',
  )
  .default([]);

export function embeddedUserParts(
  message: string,
  references: ResearchDataReferenceV1[],
): MessagePart[] {
  return [
    { type: 'text', text: message },
    ...(references.length ? [{ type: 'research_data_references' as const, references }] : []),
  ];
}
