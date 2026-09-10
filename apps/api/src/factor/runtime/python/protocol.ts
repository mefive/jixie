import { z } from 'zod';
import {
  runtimeNameSchema,
  finiteNumberSchema,
  uniqueIdentifierListSchema,
  MAX_ERROR_CHARACTERS,
  runtimeLogFrameSchema,
  runtimeErrorFrameSchema,
} from '#infra/runtime/python/protocol.js';

const MAX_FACTOR_VALUES = 1_000_000;

const crossSectionalFactorMetadataSchema = z.strictObject({
  name: runtimeNameSchema,
  window: z.number().int().min(1).max(505).nullable(),
  min_coverage: finiteNumberSchema.min(0.1).max(1).nullable(),
  analysis_kind: z.literal('cross_sectional'),
  inputs: z.array(z.never()).max(0),
  target_asset_classes: z.array(z.never()).max(0),
});

const assetFactorMetadataSchema = z.strictObject({
  name: runtimeNameSchema,
  window: z.number().int().min(2).max(505),
  min_coverage: z.null(),
  analysis_kind: z.enum(['time_series', 'panel']),
  inputs: uniqueIdentifierListSchema.min(1).max(256),
  target_asset_classes: z
    .array(z.enum(['equity', 'fixed_income', 'commodity']))
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length, 'asset classes must be unique'),
});

const factorReadyFrameSchema = z.strictObject({
  type: z.literal('factor_ready'),
  metadata: z.union([crossSectionalFactorMetadataSchema, assetFactorMetadataSchema]),
});

const factorValuesFrameSchema = z.strictObject({
  type: z.literal('factor_values'),
  values: z.array(finiteNumberSchema.nullable()).max(MAX_FACTOR_VALUES),
  first_error: z.string().max(MAX_ERROR_CHARACTERS).nullable(),
});

export const factorStartupFrameSchema = z.union([
  runtimeLogFrameSchema,
  factorReadyFrameSchema,
  runtimeErrorFrameSchema,
]);

export const factorExecutionFrameSchema = z.union([
  runtimeLogFrameSchema,
  factorValuesFrameSchema,
  runtimeErrorFrameSchema,
]);
