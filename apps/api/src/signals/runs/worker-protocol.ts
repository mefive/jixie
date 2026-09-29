import { futureSignalSchema, signalAccountsSchema } from '@jixie/shared/api/signals';
import { z } from 'zod';
import { workerLogMessageSchema, workerErrorMessageSchema } from '#jobs/worker-protocol.js';
import {
  signalItemSchema,
  modelPositionSnapshotSchema,
  factorInputSummarySchema,
} from './result-schema.js';

export const signalWorkerOutputSchema = z
  .object({
    resultVersion: z.number().int().min(1).max(2).default(1),
    modelAccounts: signalAccountsSchema.nullable().default(null),
    futureSignals: z.array(futureSignalSchema).default([]),
    dataCutoff: z.string(),
    modelEquity: z.number(),
    modelCash: z.number(),
    modelPositions: z.array(modelPositionSnapshotSchema),
    signals: z.array(signalItemSchema),
    factorInputs: z.array(factorInputSummarySchema),
  })
  .superRefine((output, context) => {
    if (
      (output.resultVersion === 2 && !output.modelAccounts) ||
      (output.resultVersion === 1 && (output.modelAccounts || output.futureSignals.length))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Signal result version does not match account payload',
      });
    }
  });
export type SignalWorkerOutput = z.infer<typeof signalWorkerOutputSchema>;

export const signalWorkerMessageSchema = z.discriminatedUnion('type', [
  workerLogMessageSchema,
  workerErrorMessageSchema,
  z.object({ type: z.literal('done'), output: signalWorkerOutputSchema }),
]);
export type SignalWorkerMessage = z.infer<typeof signalWorkerMessageSchema>;
