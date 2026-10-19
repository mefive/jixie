import { z } from 'zod';
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
  z.strictObject({ type: z.literal('retired_chart'), title: z.string().max(120) }),
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

// Turns.
export const activeTurnQuerySchema = z.object({
  // Accept the historical Screen prefix for old clients; no current page creates Screen turns.
  entity: z.string().regex(/^(strategy|factor|factor-question|screen|research):[A-Za-z0-9]+$/),
});

// HTTP input types describe values before defaults and transformations.
export type ActiveAgentTurnRequestQuery = z.input<typeof activeTurnQuerySchema>;
export type ChatMessagesRequest = z.input<typeof chatMessagesSchema>;

/**
 * 接受请求携带正在比较的编辑器源码，服务端据此拒绝过时的比较。
 *
 * Acceptance carries the compared editor source so stale comparisons are rejected server-side.
 */
export const acceptCodeChangeSchema = z.strictObject({
  beforeCode: z.string().max(100_000),
});

export type AcceptCodeChangeInput = z.output<typeof acceptCodeChangeSchema>;
export type AcceptCodeChangeRequest = z.input<typeof acceptCodeChangeSchema>;
