import { z } from 'zod';
import { workerLogMessageSchema, workerErrorMessageSchema } from '#jobs/worker-protocol.js';

export const factorCorrelationWorkerMessageSchema = z.discriminatedUnion('type', [
  workerLogMessageSchema,
  workerErrorMessageSchema,
  z.object({ type: z.literal('done'), payload: z.string() }),
]);
export type FactorCorrelationWorkerMessage = z.infer<typeof factorCorrelationWorkerMessageSchema>;
