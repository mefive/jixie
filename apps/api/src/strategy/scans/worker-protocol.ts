import { z } from 'zod';
import { workerLogMessageSchema, workerErrorMessageSchema } from '#jobs/worker-protocol.js';
import { strategyScanPayloadSchema } from './result-schema.js';

export const strategyScanWorkerMessageSchema = z.discriminatedUnion('type', [
  workerLogMessageSchema,
  workerErrorMessageSchema,
  z.object({ type: z.literal('done'), payload: strategyScanPayloadSchema }),
]);
export type StrategyScanWorkerMessage = z.infer<typeof strategyScanWorkerMessageSchema>;

export const strategyScanControlSchema = z.object({ type: z.literal('stop') });
export type StrategyScanControl = z.infer<typeof strategyScanControlSchema>;
