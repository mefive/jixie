import { z } from 'zod';
import { chatMessagesSchema } from '../../lib/chat-schema.js';
import { codeConfigSchema } from '../runtime/typescript/schema.js';

export const createStrategySchema = codeConfigSchema.extend({
  name: z.string().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(2000).optional(),
  messages: chatMessagesSchema.optional(),
});

export const updateStrategySchema = z.object({
  config: codeConfigSchema.optional(),
  messages: chatMessagesSchema.optional(),
});
