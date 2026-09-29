import { z } from 'zod';
const number = z.number().finite();
const nullableNumber = number.nullable();
export const futureMarketSchema = z.object({
  contracts: z.array(
    z.object({
      tsCode: z.string(),
      productCode: z.enum(['IF', 'IH', 'IC', 'IM']),
      multiplier: number.positive(),
      listDate: z.string(),
      delistDate: z.string(),
    }),
  ),
  daily: z.array(
    z.object({
      tsCode: z.string(),
      tradeDate: z.string(),
      open: nullableNumber,
      high: nullableNumber,
      low: nullableNumber,
      close: nullableNumber,
      settle: nullableNumber,
      volume: nullableNumber,
      amount: nullableNumber,
      openInterest: nullableNumber,
    }),
  ),
  mappings: z.array(
    z.object({ continuousCode: z.string(), tradeDate: z.string(), mappedTsCode: z.string() }),
  ),
  settlements: z.array(
    z.object({
      tsCode: z.string(),
      tradeDate: z.string(),
      longMarginRate: nullableNumber,
      shortMarginRate: nullableNumber,
    }),
  ),
});
