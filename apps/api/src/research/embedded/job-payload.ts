import { z } from 'zod';

export const researchEmbeddedAnalysisJobPayloadSchema = z.strictObject({
  runId: z.string().min(1),
});

export type ResearchEmbeddedAnalysisJobPayload = z.infer<
  typeof researchEmbeddedAnalysisJobPayloadSchema
>;
