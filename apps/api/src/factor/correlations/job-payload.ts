import { z } from 'zod';

export const factorCorrelationJobPayloadSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  keys: z.array(z.string().min(1)).min(2).max(8),
  freq: z.enum(['week', 'month']),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  locale: z.enum(['zh', 'en']),
});

export type FactorCorrelationJobPayload = z.infer<typeof factorCorrelationJobPayloadSchema>;
