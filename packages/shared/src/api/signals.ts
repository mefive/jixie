import { z } from 'zod';

// Deployments.
export const deploymentListQuerySchema = z.object({ strategyId: z.string().min(1) });

// Actual executions.
export const actualExecutionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('filled'),
    shares: z.number().positive(),
    price: z.number().positive(),
    fee: z.number().min(0).optional(),
    reason: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    status: z.literal('skipped'),
    reason: z.string().trim().min(1).max(100),
    note: z.string().trim().max(500).optional(),
  }),
]);

// Runs.
export const signalRunListQuerySchema = z.object({
  limit: z.coerce.number<string>().int().min(1).max(100).default(30),
});

export const signalRunJobQuerySchema = z.object({
  since: z.coerce.number<string>().int().min(0).default(0),
});

// Submission and lookup.
export const createDeploymentBodySchema = z.object({ reportId: z.string().min(1) });

// Submission and lookup.
export const submitSignalRunBodySchema = z.object({
  tradeDate: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});

// HTTP input types describe values before defaults and transformations.
export type DeploymentListRequestQuery = z.input<typeof deploymentListQuerySchema>;
export type ActualExecutionRequest = z.input<typeof actualExecutionSchema>;
export type SignalRunListRequestQuery = z.input<typeof signalRunListQuerySchema>;
export type SignalRunJobRequestQuery = z.input<typeof signalRunJobQuerySchema>;
export type CreateDeploymentRequest = z.input<typeof createDeploymentBodySchema>;
export type SubmitSignalRunRequest = z.input<typeof submitSignalRunBodySchema>;

const finite = z.number().finite();
const date = z.string().regex(/^\d{8}$/);
const positive = finite.positive();

export const futurePositionSchema = z.object({
  code: z.string(),
  actualCode: z.string(),
  contracts: finite.int(),
  referencePrice: positive,
  multiplier: positive,
  margin: finite.nonnegative(),
});

export const futureAccountSchema = z.object({
  equity: finite,
  margin: finite.nonnegative(),
  availableCash: finite,
  positions: z.array(futurePositionSchema),
});

export const futureIntentSchema = z.object({
  kind: z.enum(['delta', 'contracts', 'notional', 'hedge', 'roll']),
  value: finite,
});

export const executionLegSchema = z.object({
  id: z.string(),
  code: z.string(),
  actualCode: z.string(),
  action: z.enum(['buy', 'sell']),
  effect: z.enum(['open', 'close']),
  positionSide: z.enum(['long', 'short']),
  contracts: positive.int(),
  multiplier: positive,
  dependsOnLegId: z.string().nullable(),
});

export const futureSignalSchema = z.object({
  assetType: z.literal('future'),
  code: z.string(),
  name: z.string(),
  intent: futureIntentSchema,
  decisionDate: date,
  execDate: date,
  actualCode: z.string(),
  mappingDate: date,
  referencePrice: positive,
  multiplier: positive,
  referenceTargetContracts: finite.int(),
  referenceNotional: finite,
  referenceMargin: finite.nonnegative(),
  marginSource: z.enum(['data', 'config']),
  referenceLegs: z.array(executionLegSchema),
});

export const resolutionContextSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  clientRequestId: z.string().min(1).max(100),
  exposureAsOf: z.iso.datetime({ offset: true }),
  cashExposure: finite.nonnegative(),
  price: positive,
  priceSource: z.string().trim().min(1).max(200),
  dependenciesConfirmed: z.literal(true),
});

export const signalFillSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  clientRequestId: z.string().min(1).max(100),
  resolutionId: z.string().optional(),
  legId: z.string().optional(),
  actualCode: z.string().min(1),
  action: z.enum(['buy', 'sell']),
  effect: z.enum(['open', 'close']),
  quantity: positive,
  price: positive,
  fee: finite.nonnegative(),
  executedAt: z.iso.datetime({ offset: true }),
  tradeDate: date,
  sequence: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
});

export const reviseSignalFillSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    clientRequestId: z.string().min(1).max(100),
    void: z.boolean(),
    replacement: signalFillSchema
      .omit({ expectedRevision: true, clientRequestId: true })
      .optional(),
  })
  .refine((input) => (input.void ? !input.replacement : !!input.replacement), {
    message: 'Supply a replacement or void the fill',
  });

export type SignalResolutionInput = z.output<typeof resolutionContextSchema>;
export type SignalFillInput = z.output<typeof signalFillSchema>;
export type SignalFillRevisionInput = z.output<typeof reviseSignalFillSchema>;

export const cashAccountPositionSchema = z.object({
  code: z.string(),
  shares: finite.nonnegative(),
  avgCost: finite.nonnegative(),
  frozenUntil: date,
  frozenShares: finite.nonnegative(),
  markPrice: positive,
  adjustmentFactor: positive,
  assetType: z.enum(['stock', 'etf']),
});
export const accountConditionSchema = z
  .object({
    key: z.string(),
    code: z.string(),
    placedDate: date,
    kind: z.enum(['stop_loss', 'trailing_stop', 'limit_buy', 'take_profit']),
    triggerPrice: positive.optional(),
    trailingPct: positive.max(1).optional(),
    highWater: positive.optional(),
    shares: positive.optional(),
  })
  .refine(
    (condition) => {
      switch (condition.kind) {
        case 'trailing_stop':
          return condition.highWater != null && condition.trailingPct != null;
        case 'limit_buy':
          return condition.triggerPrice != null && condition.shares != null;
        default:
          return condition.triggerPrice != null;
      }
    },
    { message: 'Incomplete conditional order' },
  );
export const signalAccountsSchema = z.object({
  version: z.literal(2),
  date,
  cash: finite,
  positions: z.array(cashAccountPositionSchema),
  futures: futureAccountSchema,
  conditions: z.array(accountConditionSchema),
  consumedConditions: z.array(z.string()).default([]),
  equity: finite,
  risk: z.array(z.string()),
});

export const signalTaskDecisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  status: z.enum(['pending', 'skipped']),
  reason: z.string().trim().min(1).max(500),
});
export type SignalTaskDecisionInput = z.output<typeof signalTaskDecisionSchema>;

export const signalMarketRevisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  tradeDate: z.string().regex(/^\d{8}$/),
  reason: z.string().trim().min(1).max(1000),
});
export type SignalMarketRevisionInput = z.output<typeof signalMarketRevisionSchema>;
export type SignalMarketRevisionRequest = z.input<typeof signalMarketRevisionSchema>;

export type SignalResolutionRequest = z.input<typeof resolutionContextSchema>;
export type SignalFillRequest = z.input<typeof signalFillSchema>;
export type SignalFillRevisionRequest = z.input<typeof reviseSignalFillSchema>;
export type SignalTaskDecisionRequest = z.input<typeof signalTaskDecisionSchema>;

export const actualSignalResolutionSchema = z.object({
  input: resolutionContextSchema,
  target: finite.int(),
  legs: z.array(executionLegSchema),
  status: z.enum(['ready', 'no_action']),
  accountDate: date,
  fillIds: z.array(z.string()),
});
export const simulatedSignalResolutionSchema = z.object({
  generation: z.string(),
  status: z.enum(['filled', 'no_action']),
  priceBasis: z.literal('daily_simulation'),
  date,
  mappingDate: date,
  trades: z.array(
    z.looseObject({
      date,
      code: z.string(),
      assetType: z.enum(['stock', 'etf', 'future']),
      side: z.enum(['buy', 'sell']),
      realShares: finite.nonnegative(),
      realPrice: positive,
      price: positive,
      shares: finite,
      amount: finite.nonnegative(),
      fee: finite.nonnegative(),
      slippageCost: finite,
    }),
  ),
});
