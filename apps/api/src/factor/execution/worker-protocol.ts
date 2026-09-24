import { z } from 'zod';
import { workerLogMessageSchema, workerErrorMessageSchema } from '#jobs/worker-protocol.js';

export const factorAnalysisWorkerMessageSchema = z.discriminatedUnion('type', [
  workerLogMessageSchema,
  workerErrorMessageSchema,
  z.object({ type: z.literal('done'), reportId: z.string(), payload: z.string() }),
]);
export type FactorAnalysisWorkerMessage = z.infer<typeof factorAnalysisWorkerMessageSchema>;
