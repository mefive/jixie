import { z } from 'zod';
import { MAX_LOG_BATCH_ENTRIES } from './log-buffer.js';

export const MAX_ERROR_CHARACTERS = 256 * 1024;

export const MAX_IDENTIFIER_CHARACTERS = 256;

export const MAX_LIST_ITEMS = 10_000;

export const MAX_LOG_CHARACTERS = 20_000;

export const finiteNumberSchema = z.number().finite();

export const identifierSchema = z.string().min(1).max(MAX_IDENTIFIER_CHARACTERS);

export const identifierListSchema = z.array(identifierSchema).max(MAX_LIST_ITEMS);

export const uniqueIdentifierListSchema = identifierListSchema.refine(
  (values) => new Set(values).size === values.length,
  'identifiers must be unique',
);

export const runtimeNameSchema = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0, 'name must not be blank');

export const runtimeLogEntrySchema = z.strictObject({
  level: z.enum(['info', 'warning', 'error']),
  text: z.string().max(MAX_LOG_CHARACTERS),
});

export const runtimeLogFrameSchema = runtimeLogEntrySchema.extend({ type: z.literal('log') });

export const runtimeLogBatchFrameSchema = z.strictObject({
  type: z.literal('log_batch'),
  entries: z.array(runtimeLogEntrySchema).min(1).max(MAX_LOG_BATCH_ENTRIES),
});

export type RuntimeLogFrame = z.infer<typeof runtimeLogFrameSchema>;
export type RuntimeLogBatchFrame = z.infer<typeof runtimeLogBatchFrameSchema>;

export const runtimeErrorFrameSchema = z.union([
  z.strictObject({
    type: z.literal('error'),
    message: z.string().max(MAX_ERROR_CHARACTERS),
  }),
  z.strictObject({
    type: z.literal('fatal'),
    message: z.string().max(MAX_ERROR_CHARACTERS),
  }),
]);
