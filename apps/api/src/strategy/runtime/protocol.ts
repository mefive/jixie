import { z } from 'zod';
import {
  finiteNumberSchema,
  runtimeNameSchema,
  uniqueIdentifierListSchema,
  identifierSchema,
  MAX_LIST_ITEMS,
  runtimeLogFrameSchema,
  runtimeErrorFrameSchema,
  MAX_IDENTIFIER_CHARACTERS,
} from '#infra/runtime/protocol.js';

const strategyParameterStringSchema = z
  .string()
  .max(100)
  .refine((value) => value.trim().length > 0, 'parameter must not be blank');

const strategyAccountsSchema = z
  .strictObject({
    stock: z.strictObject({ cashWeight: finiteNumberSchema.min(0).max(1) }),
    futures: z.strictObject({ cashWeight: finiteNumberSchema.min(0).max(1) }),
  })
  .refine(
    (accounts) => Math.abs(accounts.stock.cashWeight + accounts.futures.cashWeight - 1) <= 1e-9,
    'account cash weights must sum to 1',
  );

const strategyMetadataSchema = z.strictObject({
  name: runtimeNameSchema,
  params: boundedRecord(z.union([finiteNumberSchema, strategyParameterStringSchema]), 256),
  factors: uniqueIdentifierListSchema,
  watch: uniqueIdentifierListSchema,
  futures: uniqueIdentifierListSchema,
  accounts: strategyAccountsSchema.nullable(),
});

const strategyReadyFrameSchema = z.strictObject({
  type: z.literal('ready'),
  metadata: strategyMetadataSchema,
});

const strategyRequestFrameSchema = z.union([
  z.strictObject({
    type: z.literal('request'),
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method: z.literal('context_data'),
    arguments: z.discriminatedUnion('operation', [
      z.strictObject({
        operation: z.literal('cross_section'),
        index_code: identifierSchema.nullable(),
      }),
      z.strictObject({ operation: z.literal('ensure_bars'), codes: uniqueIdentifierListSchema }),
      z.strictObject({ operation: z.literal('index_members'), index_code: identifierSchema }),
    ]),
  }),
  z.strictObject({
    type: z.literal('request'),
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method: z.literal('cross_section'),
    arguments: z.strictObject({
      index_code: identifierSchema.nullable(),
    }),
  }),
  z.strictObject({
    type: z.literal('request'),
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method: z.literal('bars'),
    arguments: z.strictObject({
      codes: uniqueIdentifierListSchema,
    }),
  }),
]);

export const strategyCommandSchema = z.discriminatedUnion('operation', [
  commandSchema('futures.orderContracts', {
    code: identifierSchema,
    contracts: finiteNumberSchema,
  }),
  commandSchema('futures.setTargetContracts', {
    code: identifierSchema,
    contracts: finiteNumberSchema,
  }),
  commandSchema('futures.setTargetNotional', {
    code: identifierSchema,
    notional: finiteNumberSchema,
  }),
  commandSchema('futures.hedgeStock', { code: identifierSchema, beta: finiteNumberSchema }),
  commandSchema('futures.closePosition', { code: identifierSchema }),
  commandSchema('stock.setTargetWeight', {
    code: identifierSchema,
    weight: finiteNumberSchema,
  }),
  commandSchema('stock.setTargetWeights', {
    weights: boundedRecord(finiteNumberSchema, MAX_LIST_ITEMS),
  }),
  commandSchema('stock.orderAdjustedShares', {
    code: identifierSchema,
    shares: finiteNumberSchema,
  }),
  commandSchema('stock.orderLots', {
    code: identifierSchema,
    lots: finiteNumberSchema,
  }),
  commandSchema('stock.closePosition', { code: identifierSchema }),
  commandSchema('stock.stopLossAtAdjustedPrice', {
    code: identifierSchema,
    price: finiteNumberSchema,
  }),
  commandSchema('stock.trailingStopByFraction', {
    code: identifierSchema,
    percentage: finiteNumberSchema,
  }),
  commandSchema('stock.limitBuyAtAdjustedPrice', {
    code: identifierSchema,
    price: finiteNumberSchema,
    shares: finiteNumberSchema,
  }),
  commandSchema('stock.takeProfitByFraction', {
    code: identifierSchema,
    percentage: finiteNumberSchema,
  }),
  commandSchema('stock.cancelConditional', {
    code: identifierSchema,
    kind: z.enum(['stop_loss', 'trailing_stop', 'limit_buy', 'take_profit']).nullable(),
  }),
]);

const strategyDoneFrameSchema = z.strictObject({
  type: z.literal('done'),
  commands: z.array(strategyCommandSchema).max(MAX_LIST_ITEMS),
});

export const strategyStartupFrameSchema = z.union([
  runtimeLogFrameSchema,
  strategyReadyFrameSchema,
  runtimeErrorFrameSchema,
]);

export const strategyExecutionFrameSchema = z.union([
  runtimeLogFrameSchema,
  strategyRequestFrameSchema,
  strategyDoneFrameSchema,
  runtimeErrorFrameSchema,
]);

export type StrategyMetadata = z.infer<typeof strategyMetadataSchema>;

export type StrategyCommand = z.infer<typeof strategyCommandSchema>;

export type StrategyRequestFrame = z.infer<typeof strategyRequestFrameSchema>;

function commandSchema<Operation extends string, Shape extends z.ZodRawShape>(
  operation: Operation,
  argumentsShape: Shape,
) {
  return z.strictObject({
    operation: z.literal(operation),
    arguments: z.strictObject(argumentsShape),
  });
}

function boundedRecord<Value extends z.ZodType>(
  valueSchema: Value,
  maximumEntries: number,
): z.ZodType<Record<string, z.output<Value>>> {
  return z
    .record(z.string().min(1).max(MAX_IDENTIFIER_CHARACTERS), valueSchema)
    .refine(
      (value) => Object.keys(value).length <= maximumEntries,
      `record must contain at most ${maximumEntries} entries`,
    );
}
