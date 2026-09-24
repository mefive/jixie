import { z } from 'zod';
import type { SignalItem, ModelPositionSnapshot, FactorInputSummary } from '@jixie/shared';

const signalAssetTypeSchema = z.enum(['stock', 'etf']);

const signalActionSchema = z.enum(['buy', 'sell']);

const signalSourceSchema = z.enum(['target', 'order', 'conditional']);

export const signalItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  assetType: signalAssetTypeSchema,
  action: signalActionSchema,
  shares: z.number(),
  refPrice: z.number(),
  refAmount: z.number(),
  source: signalSourceSchema,
  orderType: z
    .enum(['market_open', 'stop_loss', 'trailing_stop', 'limit_buy', 'take_profit'])
    .optional(),
  triggerPrice: z.number().optional(),
  trailingPct: z.number().optional(),
  targetWeight: z.number().optional(),
}) satisfies z.ZodType<SignalItem>;

export const modelPositionSnapshotSchema = z.object({
  code: z.string(),
  name: z.string(),
  assetType: signalAssetTypeSchema,
  shares: z.number(),
  markPrice: z.number(),
  sellableFrom: z.string(),
  frozenShares: z.number().optional(),
}) satisfies z.ZodType<ModelPositionSnapshot>;

const factorInputObservationSchema = z.object({
  assetId: z.string(),
  value: z.union([z.null(), z.number()]),
});

export const factorInputSummarySchema = z.object({
  factorId: z.string(),
  key: z.string(),
  asOfDate: z.string(),
  observedAssets: z.number(),
  validAssets: z.number(),
  minValue: z.union([z.null(), z.number()]),
  maxValue: z.union([z.null(), z.number()]),
  meanValue: z.union([z.null(), z.number()]),
  decisionObservations: z.array(factorInputObservationSchema),
}) satisfies z.ZodType<FactorInputSummary>;
