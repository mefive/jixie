import { z } from 'zod';

/**
 * Zod schemas for the strategy IR — the runtime validation gate. Shared by the backtest route (full
 * BacktestConfig) and the NL→IR parser (strategy only). Mirrors the @jixie/shared IR types; keep in
 * sync when the IR grows.
 */

const exprSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('const'), value: z.number() }),
    z.object({ kind: z.literal('field'), name: z.string().min(1) }),
    z.object({ kind: z.literal('factor'), name: z.string().min(1) }),
    z.object({ kind: z.literal('unary'), op: z.enum(['neg', 'abs', 'ln']), arg: exprSchema }),
    z.object({
      kind: z.literal('binary'),
      op: z.enum(['+', '-', '*', '/']),
      left: exprSchema,
      right: exprSchema,
    }),
  ]),
);

const universeFilterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('minListDays'), days: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('dropIlliquidPct'), pct: z.number().min(0).max(100) }),
  z.object({
    kind: z.literal('field'),
    field: z.string().min(1),
    op: z.enum(['>', '>=', '<', '<=']),
    value: z.number(),
  }),
]);

// —— indicator expr + boolean condition (used by the timing stage) ——

const indExprSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('const'), value: z.number() }),
    z.object({ kind: z.literal('price') }),
    z.object({
      kind: z.literal('indicator'),
      name: z.enum(['highest', 'lowest', 'sma', 'ema', 'atr']),
      field: z.enum(['open', 'high', 'low', 'close']).optional(),
      window: z.number().int().positive(),
    }),
    z.object({ kind: z.literal('state'), name: z.string().min(1) }),
    z.object({ kind: z.literal('shares') }),
    z.object({ kind: z.literal('equity') }),
    z.object({ kind: z.literal('unary'), op: z.enum(['neg', 'abs', 'floor']), arg: indExprSchema }),
    z.object({
      kind: z.literal('binary'),
      op: z.enum(['+', '-', '*', '/', 'min', 'max']),
      left: indExprSchema,
      right: indExprSchema,
    }),
  ]),
);

const conditionSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('compare'),
      op: z.enum(['>', '>=', '<', '<=', '==', '!=']),
      left: indExprSchema,
      right: indExprSchema,
    }),
    z.object({ kind: z.literal('and'), args: z.array(conditionSchema) }),
    z.object({ kind: z.literal('or'), args: z.array(conditionSchema) }),
    z.object({ kind: z.literal('not'), arg: conditionSchema }),
  ]),
);

const timingActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('buy') }),
  z.object({ kind: z.literal('order'), shares: indExprSchema }),
  z.object({ kind: z.literal('exit') }),
  z.object({ kind: z.literal('set'), var: z.string().min(1), value: indExprSchema }),
]);

const timingRuleSchema = z.object({
  when: conditionSchema,
  do: z.array(timingActionSchema).min(1),
});

// —— pipeline IR: an ordered list of stage nodes ——

const sizingMethodSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('equal') }),
  z.object({ kind: z.literal('equityPct'), pct: z.number().gt(0).max(1) }),
  z.object({ kind: z.literal('kSlots'), k: z.number().int().positive() }),
]);

const stageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('universe'),
    source: z.discriminatedUnion('type', [
      z.object({ type: z.literal('all') }),
      z.object({ type: z.literal('list'), codes: z.array(z.string().min(1)).min(1).max(500) }),
    ]),
  }),
  z.object({ kind: z.literal('filter'), filters: z.array(universeFilterSchema) }),
  z.object({
    kind: z.literal('select'),
    score: exprSchema,
    factors: z.array(z.string()).optional(),
    side: z.enum(['high', 'low']),
    pick: z.object({ by: z.enum(['quantile', 'topN']), value: z.number().positive() }),
  }),
  z.object({
    kind: z.literal('timing'),
    state: z.array(z.object({ name: z.string().min(1), init: z.number() })).optional(),
    rules: z.array(timingRuleSchema).min(1),
    membership: z.enum(['gate', 'hard']),
  }),
  z.object({ kind: z.literal('sizing'), method: sizingMethodSchema }),
]);

export const pipelineSchema = z
  .object({
    schedule: z.enum(['daily', 'weekly', 'monthly']),
    stages: z.array(stageSchema).min(2),
  })
  .refine(
    (p) => p.stages.some((s) => s.kind === 'universe') && p.stages.some((s) => s.kind === 'sizing'),
    { message: 'pipeline 必须包含 universe 和 sizing 阶段' },
  );

/** A strategy IR — a stage pipeline. */
export const strategySchema = pipelineSchema;

/** A full, runnable backtest config (range + capital + cost + strategy). */
export const configSchema = z.object({
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
    })
    .optional(),
  strategy: strategySchema,
});

/** Validate an unknown object as a strategy IR. Returns flattened, human-readable errors on failure
 * (fed back to the model by the NL→IR repair loop). */
export function validateStrategyIR(
  obj: unknown,
): { ok: true; ir: z.infer<typeof strategySchema> } | { ok: false; errors: string[] } {
  const r = strategySchema.safeParse(obj);
  if (r.success) return { ok: true, ir: r.data };
  const errors = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  return { ok: false, errors };
}
