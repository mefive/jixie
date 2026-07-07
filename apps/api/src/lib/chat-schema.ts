import { z } from 'zod';
import { screenSpecSchema } from '../screen/spec.js';
import { chartSpecSchema } from './chart-spec.js';

/** Wire validation for parts-shaped agent conversations (shared by strategy / factor / screen routes).
 * The frontend normalizes legacy `{ role, content }` rows on read, so the API only accepts the new shape. */
export const messagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(8000) }),
  z.object({ type: z.literal('card'), title: z.string().max(120), spec: screenSpecSchema }),
  z.object({ type: z.literal('chart'), title: z.string().max(120), chart: chartSpecSchema }),
]);

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  parts: z.array(messagePartSchema).min(1).max(20),
});

export const chatMessagesSchema = z.array(chatMessageSchema).max(60);
