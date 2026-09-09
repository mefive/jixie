import { z } from 'zod';
import { codeConfigSchema } from '../runtime/typescript/schema.js';

export const scanStrategyQuerySchema = z.object({ strategyId: z.string().min(1) });

export const scanJobQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });

export const strategyScanParametersSchema = z.object({
  code: z.string().min(1).max(50_000),
  language: z.enum(['typescript', 'python']).optional(),
});

export const scanSpecSchema = z.object({
  dimensions: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        values: z
          .array(z.union([z.number().finite(), z.string().trim().min(1).max(100)]))
          .min(2)
          .max(25),
      }),
    )
    .min(1)
    .max(2),
  splitDate: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  view: z.enum(['parameters', 'sizing', 'capacity']).optional(),
});

export const submitStrategyScanSchema = z.object({
  config: codeConfigSchema,
  spec: scanSpecSchema,
});
