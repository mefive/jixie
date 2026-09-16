import { z } from 'zod';
import { chatMessagesSchema } from '#agent/schema.js';
import { embeddedDataReferencesSchema } from '#research/schema.js';

// Runnable configuration.
/** Validation for a code-first BacktestConfig (the /backtest and /strategies request body). The code is
 * a length-bounded string; it's compiled (and may fail) at run time, not validated structurally here. */
export const codeConfigSchema = z.object({
  name: z.string().min(1).max(100),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  initialCash: z.number().positive(),
  cost: z
    .object({
      commission: z.number().min(0).optional(),
      minCommission: z.number().min(0).optional(),
      stampDuty: z.number().min(0).optional(),
      transferFee: z.number().min(0).optional(),
      slippageBps: z.number().min(0).max(10_000).optional(),
      impactCoef: z.number().min(0).max(10).optional(),
      futureCommissionRate: z.number().min(0).optional(),
      futureCloseTodayRate: z.number().min(0).optional(),
      futureSlippageTicks: z.number().min(0).optional(),
      futureMarginRate: z.number().positive().max(1).optional(),
    })
    .optional(),
  language: z.enum(['typescript', 'python']).optional(),
  runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
  code: z.string().min(1).max(50_000),
});

// Definitions.
export const createStrategySchema = codeConfigSchema.extend({
  name: z.string().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(2000).optional(),
  messages: chatMessagesSchema.optional(),
});

export const updateStrategySchema = z.object({
  config: codeConfigSchema.optional(),
  messages: chatMessagesSchema.optional(),
});

// Visibility.
export const strategyVisibilitySchema = z.object({ visibility: z.enum(['private', 'public']) });

// Backtests.
export const backtestStrategyIdentitySchema = z.object({ strategyId: z.string().min(1) });

export const backtestJobQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });

// Parameter scans.
export const scanStrategyIdentitySchema = z.object({ strategyId: z.string().min(1) });

export const scanJobQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });

export const strategyScanParametersSchema = z.object({
  code: z.string().min(1).max(50_000),
  language: z.enum(['typescript', 'python']).optional(),
});

const scanSpecSchema = z.object({
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

// Agent.
export const strategyAgentInputSchema = z.object({
  id: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
  reportId: z.string().min(1).max(128).optional(),
  dataReferences: embeddedDataReferencesSchema,
  code: z.string().min(1).max(50_000),
  language: z.enum(['typescript', 'python']).optional(),
});

export const strategyAgentBodySchema = strategyAgentInputSchema.omit({ id: true });
