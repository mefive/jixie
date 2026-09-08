import { z } from 'zod';
import { chatMessagesSchema } from '../../lib/chat-schema.js';

export const FACTOR_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export const createFactorDraftSchema = z.object({
  key: z.string().trim().regex(FACTOR_KEY_PATTERN),
  name: z.string().min(1).max(40),
  code: z.string().min(1),
  analysisKind: z.enum(['cross_sectional', 'time_series', 'panel']).default('cross_sectional'),
  language: z.enum(['typescript', 'python']).default('typescript'),
  messages: chatMessagesSchema.optional(),
});

export const updateFactorDraftSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).max(40).optional(),
  messages: chatMessagesSchema.optional(),
});
