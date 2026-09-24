import { z } from 'zod';
import type { StrategyScanPayload } from '@jixie/shared';

import { strategyParamValueSchema } from '@jixie/shared/api/strategy';

const backtestMetricSummarySchema = z.object({
  start: z.string(),
  end: z.string(),
  days: z.number(),
  finalValue: z.number(),
  totalReturn: z.number(),
  annReturn: z.number(),
  sharpe: z.number(),
  maxDrawdown: z.number(),
  trades: z.number(),
  benchReturn: z.number(),
  excessReturn: z.number(),
  informationRatio: z.number(),
  calmar: z.number(),
  winRate: z.number(),
  profitFactor: z.number(),
  turnover: z.number(),
  totalFees: z.number(),
  totalSlippage: z.number(),
  annVolatility: z.number().optional(),
  maxUnderwaterDays: z.number().optional(),
  annSlippageDrag: z.number().optional(),
});

const strategyScanCellSchema = z.object({
  params: z.record(z.string(), strategyParamValueSchema),
  full: backtestMetricSummarySchema.optional(),
  inSample: backtestMetricSummarySchema.optional(),
  outOfSample: backtestMetricSummarySchema.optional(),
  nav: z
    .array(
      z.object({
        date: z.string(),
        value: z.number(),
      }),
    )
    .optional(),
});

export const strategyScanPayloadSchema = z.object({
  parameters: z.record(z.string(), strategyParamValueSchema),
  cells: z.array(strategyScanCellSchema),
}) satisfies z.ZodType<StrategyScanPayload>;
