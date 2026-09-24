import { z } from 'zod';
import { workerLogMessageSchema, workerErrorMessageSchema } from '#jobs/worker-protocol.js';
import { backtestSummarySchema } from './result-schema.js';

export const backtestWorkerMessageSchema = z.discriminatedUnion('type', [
  workerLogMessageSchema,
  workerErrorMessageSchema,
  z.object({ type: z.literal('done'), payload: backtestSummarySchema }),
]);
export type BacktestWorkerMessage = z.infer<typeof backtestWorkerMessageSchema>;
