import { z } from 'zod';
import type { LogLine } from '@jixie/shared';

const logLineSchema = z.object({
  source: z.enum(['system', 'user']),
  level: z.enum(['info', 'warn', 'error']),
  text: z.string(),
}) satisfies z.ZodType<LogLine>;

export const workerLogMessageSchema = z.object({ type: z.literal('log'), entry: logLineSchema });
export const workerErrorMessageSchema = z.object({ type: z.literal('error'), message: z.string() });

export type WorkerLogMessage = z.infer<typeof workerLogMessageSchema>;
export type WorkerErrorMessage = z.infer<typeof workerErrorMessageSchema>;
