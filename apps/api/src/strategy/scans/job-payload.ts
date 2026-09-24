import { z } from 'zod';
import {
  codeConfigSchema,
  strategyScanSpecSchema,
  strategyParamValueSchema,
} from '@jixie/shared/api/strategy';

export const strategyScanJobPayloadSchema = z.object({
  task: z.literal('strategy-scan'),
  reportId: z.string().min(1),
  config: codeConfigSchema,
  spec: strategyScanSpecSchema,
  parameters: z.record(z.string(), strategyParamValueSchema),
  ranges: z.union([
    z.object({ full: z.object({ start: z.string(), end: z.string() }) }),
    z.object({
      inSample: z.object({ start: z.string(), end: z.string() }),
      outOfSample: z.object({ start: z.string(), end: z.string() }),
    }),
  ]),
  userId: z.string().min(1),
  locale: z.enum(['zh', 'en']),
});

export type StrategyScanJobPayload = z.infer<typeof strategyScanJobPayloadSchema>;

export const strategyScanWorkerInputSchema = strategyScanJobPayloadSchema.omit({
  task: true,
  reportId: true,
});
export type StrategyScanWorkerInput = z.infer<typeof strategyScanWorkerInputSchema>;
