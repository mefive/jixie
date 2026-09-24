import { z } from 'zod';
import { codeConfigSchema } from '@jixie/shared/api/strategy';

export const backtestJobPayloadSchema = z.object({
  task: z.literal('backtest'),
  reportId: z.string().min(1),
  strategyId: z.string().min(1),
  userId: z.string().min(1),
  locale: z.enum(['zh', 'en']),
  config: codeConfigSchema,
});

export type BacktestJobPayload = z.infer<typeof backtestJobPayloadSchema>;

export const backtestWorkerInputSchema = backtestJobPayloadSchema.omit({
  task: true,
  reportId: true,
});
export type BacktestWorkerInput = z.infer<typeof backtestWorkerInputSchema>;
