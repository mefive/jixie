import { z } from 'zod';
import { chatMessagesSchema } from './agent.js';
import { embeddedDataReferencesSchema } from './research.js';

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

export type StrategyCodeConfigInput = z.output<typeof codeConfigSchema>;

// Definitions.
export const createStrategySchema = codeConfigSchema.extend({
  name: z.string().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(2000).optional(),
  messages: chatMessagesSchema.optional(),
});

export type CreateStrategyInput = z.output<typeof createStrategySchema>;

export const updateStrategySchema = z.object({
  config: codeConfigSchema.optional(),
  messages: chatMessagesSchema.optional(),
});

export type UpdateStrategyInput = z.output<typeof updateStrategySchema>;

// Visibility.
export const strategyVisibilitySchema = z.object({ visibility: z.enum(['private', 'public']) });

export type StrategyVisibilityInput = z.output<typeof strategyVisibilitySchema>;

// Backtests.
export const backtestStrategyIdentitySchema = z.object({ strategyId: z.string().min(1) });

export type StrategyBacktestIdentityQuery = z.output<typeof backtestStrategyIdentitySchema>;

export const backtestJobQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });

export type StrategyBacktestJobQuery = z.output<typeof backtestJobQuerySchema>;

// Parameter scans.
export const scanStrategyIdentitySchema = z.object({ strategyId: z.string().min(1) });

export type StrategyScanIdentityQuery = z.output<typeof scanStrategyIdentitySchema>;

export const scanJobQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });

export type StrategyScanJobQuery = z.output<typeof scanJobQuerySchema>;

export const strategyScanParametersSchema = z.object({
  code: z.string().min(1).max(50_000),
  language: z.enum(['typescript', 'python']).optional(),
});

export type StrategyScanParametersInput = z.output<typeof strategyScanParametersSchema>;

export const strategyParamValueSchema = z.union([z.number(), z.string()]);

/** Stored normalized scan shape; HTTP admission applies stricter bounds below. */
export const strategyScanSpecSchema = z.object({
  dimensions: z.array(
    z.object({
      key: z.string().min(1),
      values: z.array(strategyParamValueSchema),
    }),
  ),
  splitDate: z.string().optional(),
  view: z.enum(['parameters', 'sizing', 'capacity']).optional(),
});

const scanSpecSchema = strategyScanSpecSchema.extend({
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
});

export const submitStrategyScanSchema = z.object({
  config: codeConfigSchema,
  spec: scanSpecSchema,
});

export type SubmitStrategyScanInput = z.output<typeof submitStrategyScanSchema>;

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

export const strategyAgentParamsSchema = z.object({
  strategyId: strategyAgentInputSchema.shape.id,
});

// HTTP input types describe values before defaults and transformations.
export type StrategyCodeConfigRequest = z.input<typeof codeConfigSchema>;
export type CreateStrategyRequest = z.input<typeof createStrategySchema>;
export type UpdateStrategyRequest = z.input<typeof updateStrategySchema>;
export type StrategyVisibilityRequest = z.input<typeof strategyVisibilitySchema>;
export type StrategyBacktestRequestParams = z.input<typeof backtestStrategyIdentitySchema>;
export type StrategyBacktestJobRequestQuery = z.input<typeof backtestJobQuerySchema>;
export type StrategyScanRequestParams = z.input<typeof scanStrategyIdentitySchema>;
export type StrategyScanJobRequestQuery = z.input<typeof scanJobQuerySchema>;
export type InspectStrategyParametersRequest = z.input<typeof strategyScanParametersSchema>;
export type SubmitStrategyScanRequest = z.input<typeof submitStrategyScanSchema>;
export type StrategyAgentRequest = z.input<typeof strategyAgentBodySchema>;
export type StrategyAgentRequestParams = z.input<typeof strategyAgentParamsSchema>;
