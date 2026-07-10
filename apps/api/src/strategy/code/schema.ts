import { z } from 'zod';

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
      futureCommissionRate: z.number().min(0).optional(),
      futureCloseTodayRate: z.number().min(0).optional(),
      futureSlippageTicks: z.number().min(0).optional(),
      futureMarginRate: z.number().positive().max(1).optional(),
    })
    .optional(),
  code: z.string().min(1).max(50_000),
});
