import {
  createEmbeddedDataReferencesSchema,
  embeddedDataReferenceSchema,
} from '@jixie/shared/api/research';
import { researchExecutionFrameSchema } from './runtime/host/protocol.js';
import { parseResearchRequestFrame } from './runtime/host/request.js';

export const embeddedDataReferencesSchema = createEmbeddedDataReferencesSchema(
  embeddedDataReferenceSchema.superRefine((reference, context) => {
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
);
