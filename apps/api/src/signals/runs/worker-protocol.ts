import { z } from 'zod';
import { workerLogMessageSchema, workerErrorMessageSchema } from '#jobs/worker-protocol.js';
import {
  signalItemSchema,
  modelPositionSnapshotSchema,
  factorInputSummarySchema,
} from './result-schema.js';

export const signalWorkerOutputSchema = z.object({
  dataCutoff: z.string(),
  modelEquity: z.number(),
  modelCash: z.number(),
  modelPositions: z.array(modelPositionSnapshotSchema),
  signals: z.array(signalItemSchema),
  factorInputs: z.array(factorInputSummarySchema),
});
export type SignalWorkerOutput = z.infer<typeof signalWorkerOutputSchema>;

export const signalWorkerMessageSchema = z.discriminatedUnion('type', [
  workerLogMessageSchema,
  workerErrorMessageSchema,
  z.object({ type: z.literal('done'), output: signalWorkerOutputSchema }),
]);
export type SignalWorkerMessage = z.infer<typeof signalWorkerMessageSchema>;
