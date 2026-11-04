import { z } from 'zod';
import { isObservationDate } from './date.js';

const date = z
  .string()
  .regex(/^\d{8}$/)
  .refine(isObservationDate)
  .describe('Calendar date YYYYMMDD.');
const stockCode = z
  .string()
  .regex(/^\d{6}\.(SH|SZ|BJ)$/)
  .describe('Canonical stock code.');
const price = z.number().positive().describe('Unadjusted CNY per share.');
const cash = z.number().nonnegative().nullable();
const ratio = z
  .number()
  .nonnegative()
  .nullable()
  .describe('Shares per original share, or null if unknown.');

export const stockPriceRepairKey = z.strictObject({ tsCode: stockCode, tradeDate: date });
export const stockPriceRepairValues = z.strictObject({
  open: price,
  high: price,
  low: price,
  close: price,
  preClose: price.nullable(),
  pctChg: z.number().nullable().describe('Percentage points, not a fraction.'),
  vol: z.number().nonnegative().nullable().describe('Volume in lots (100 shares).'),
  amount: z.number().nonnegative().nullable().describe('Turnover in thousands of CNY.'),
});
const stockPriceInsert = stockPriceRepairValues.partial().required({
  open: true,
  high: true,
  low: true,
  close: true,
});

export const dividendRepairKey = z.strictObject({
  tsCode: stockCode,
  endDate: date.describe('Fiscal period end, YYYYMMDD.'),
  annDate: date.describe('Disclosure date for this stage, YYYYMMDD.'),
  exDate: date.nullable(),
  divProc: z.enum(['预案', '股东大会通过', '实施', '停止实施']),
  distributionKind: z.enum(['cash', 'shares', 'mixed', 'none', 'unspecified']),
});
export const dividendRepairValues = z.strictObject({
  cashDivTax: cash.describe('Pre-tax cash dividend, CNY per share. Null means unknown.'),
  cashDiv: cash.describe('After-tax cash dividend, CNY per share. Null means unknown.'),
  baseDate: date.nullable().describe('Share-base date. It is not the disclosure date.'),
  baseShare: z
    .number()
    .positive()
    .nullable()
    .describe('Share base in units of ten thousand shares.'),
  stockDividend: ratio.describe('Total bonus and capitalized shares per original share.'),
  stockBonusRate: ratio,
  stockCapitalizationRate: ratio,
  recordDate: date.nullable(),
  payDate: date.nullable(),
  implementationAnnouncementDate: date.nullable(),
  shareListingDate: date.nullable(),
});
const dividendInsert = dividendRepairValues.partial().required({
  cashDivTax: true,
  stockDividend: true,
});

export const repairMarketDatasets = ['stock-prices', 'dividends'] as const;
export type RepairMarketDataset = (typeof repairMarketDatasets)[number];
const expectedVersion = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe('Copy the selected record version from the export.');
const stockTarget = { dataset: z.literal('stock-prices'), key: stockPriceRepairKey };
const dividendTarget = { dataset: z.literal('dividends'), key: dividendRepairKey };
export const marketRepairSchema = z.union([
  z.strictObject({ ...stockTarget, op: z.literal('insert'), values: stockPriceInsert }),
  z.strictObject({
    ...stockTarget,
    op: z.literal('update'),
    expectedVersion,
    values: stockPriceRepairValues.partial(),
  }),
  z.strictObject({ ...stockTarget, op: z.literal('delete'), expectedVersion }),
  z.strictObject({ ...dividendTarget, op: z.literal('insert'), values: dividendInsert }),
  z.strictObject({
    ...dividendTarget,
    op: z.literal('update'),
    expectedVersion,
    values: dividendRepairValues.partial(),
  }),
  z.strictObject({ ...dividendTarget, op: z.literal('delete'), expectedVersion }),
]);
export type MarketRepairInput = z.output<typeof marketRepairSchema>;
