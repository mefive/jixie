import { z } from 'zod';
import { embeddedDraftSchema } from '@jixie/shared/api/research';

export const researchEmbeddedAnalysisJobPayloadSchema = z.strictObject({
  runId: z.string().min(1),
  source: embeddedDraftSchema.shape.source,
  parameters: embeddedDraftSchema.shape.parameters,
  revision: z.number().int().positive(),
});

export type ResearchEmbeddedAnalysisJobPayload = z.infer<
  typeof researchEmbeddedAnalysisJobPayloadSchema
>;
