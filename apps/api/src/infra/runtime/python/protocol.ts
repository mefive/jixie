import { z } from 'zod';

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

export const runtimeLogFrameSchema = z.strictObject({
  type: z.literal('log'),
  level: z.enum(['info', 'warning', 'error']),
  text: z.string().max(MAX_LOG_CHARACTERS),
});

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

export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export interface PythonFrame {
  type: string;
  [key: string]: unknown;
}

export const pythonFrameEnvelopeSchema = z
  .object({ type: z.string().min(1).max(64) })
  .catchall(z.unknown());
