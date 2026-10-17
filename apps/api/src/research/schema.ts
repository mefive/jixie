import {
  createEmbeddedDataReferencesSchema,
  embeddedDataReferenceSchema,
} from '@jixie/shared/api/research';
import { researchCellRunFrameSchema } from './sandbox/host/protocol.js';
import { parseResearchRequestFrame } from './sandbox/host/request.js';

export const embeddedDataReferencesSchema = createEmbeddedDataReferencesSchema(
  embeddedDataReferenceSchema.superRefine((reference, context) => {
    try {
      const frame = researchCellRunFrameSchema.parse({
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
