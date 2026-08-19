import { z } from 'zod';
import { chartSpecSchema } from './chart-spec.js';
import { universeSpecV1Schema } from '../research/spec.js';

const universePartSchema = z.strictObject({
  type: z.literal('universe'),
  title: z.string().max(120),
  spec: universeSpecV1Schema,
});

/** Wire validation for parts-shaped agent conversations (shared by strategy / factor / screen routes).
 * The frontend normalizes legacy `{ role, content }` rows on read, so the API only accepts the new shape. */
export const messagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(8000) }),
  z.object({ type: z.literal('chart'), title: z.string().max(120), chart: chartSpecSchema }),
  universePartSchema,
]);

export const chatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(messagePartSchema).min(1).max(20),
  turnId: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  createdAt: z.string().optional(),
});

export const chatMessagesSchema = z.array(chatMessageSchema).max(60);
