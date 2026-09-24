import { z } from 'zod';

export const signalsRunJobPayloadSchema = z.object({
  task: z.literal('signal'),
  runId: z.string().min(1),
  locale: z.enum(['zh', 'en']),
});

export type SignalsRunJobPayload = z.infer<typeof signalsRunJobPayloadSchema>;
