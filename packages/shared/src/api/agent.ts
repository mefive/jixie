import { z } from 'zod';
import { chartSpecSchema } from './chart.js';
import { universeSpecV1Schema } from './research.js';

// Conversation messages.
const universePartSchema = z.strictObject({
  type: z.literal('universe'),
  title: z.string().max(120),
  spec: universeSpecV1Schema,
});

/** Wire validation for parts-shaped agent conversations (shared by strategy / factor routes).
 * The frontend normalizes legacy `{ role, content }` rows on read, so the API only accepts the new shape. */
const messagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(8000) }),
  z.object({ type: z.literal('chart'), title: z.string().max(120), chart: chartSpecSchema }),
  universePartSchema,
]);

const chatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(messagePartSchema).min(1).max(20),
  turnId: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  createdAt: z.string().optional(),
});

export const chatMessagesSchema = z.array(chatMessageSchema).max(60);

// Charts.
export const sqlQueryBodySchema = z.object({ sql: z.string().min(8).max(4000) });

// Turns.
export const activeTurnQuerySchema = z.object({
  // Accept the historical Screen prefix for old clients; no current page creates Screen turns.
  entity: z.string().regex(/^(strategy|factor|factor-question|screen|research):[A-Za-z0-9]+$/),
});

// HTTP input types describe values before defaults and transformations.
export type AgentSqlRequest = z.input<typeof sqlQueryBodySchema>;
export type ActiveAgentTurnRequestQuery = z.input<typeof activeTurnQuerySchema>;
export type ChatMessagesRequest = z.input<typeof chatMessagesSchema>;
