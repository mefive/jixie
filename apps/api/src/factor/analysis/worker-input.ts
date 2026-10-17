import { z } from 'zod';
import { factorAnalysisSpecSchema, factorResearchSpecV1Schema } from '@jixie/shared/api/factor';
import { factorAnalysisRuntimeSourceSchema } from '../sources/snapshot.js';

export const factorAnalysisWorkerInputSchema = z.object({
  reportId: z.string().min(1),
  factor: z.string().min(1),
  source: factorAnalysisRuntimeSourceSchema,
  spec: z.union([factorResearchSpecV1Schema, factorAnalysisSpecSchema]),
  locale: z.enum(['zh', 'en']),
});
export type FactorAnalysisWorkerInput = z.infer<typeof factorAnalysisWorkerInputSchema>;
