import { z } from 'zod';

export const backtestStrategyQuerySchema = z.object({ strategyId: z.string().min(1) });

export const backtestJobQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });
