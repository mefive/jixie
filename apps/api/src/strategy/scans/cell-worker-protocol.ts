import { z } from 'zod';
import { workerErrorMessageSchema } from '#jobs/worker-protocol.js';
import { backtestResultSchema } from '../backtests/result-schema.js';

export const scanCellWorkerMessageSchema = z.discriminatedUnion('type', [
  workerErrorMessageSchema,
  z.object({ type: z.literal('done'), result: backtestResultSchema }),
]);
export type ScanCellWorkerMessage = z.infer<typeof scanCellWorkerMessageSchema>;
