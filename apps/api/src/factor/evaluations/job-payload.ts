import { z } from 'zod';
import { factorAnalysisWorkerInputSchema } from '../execution/worker-input.js';
import { normalizeFactorResearchSpec } from '../execution/spec.js';

export const factorAnalysisJobPayloadSchema = factorAnalysisWorkerInputSchema.extend({
  spec: factorAnalysisWorkerInputSchema.shape.spec.transform(normalizeFactorResearchSpec),
  failedMessage: z.string().min(1),
});
export type FactorAnalysisJobPayload = z.infer<typeof factorAnalysisJobPayloadSchema>;
