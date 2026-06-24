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

export const crossSectionSchema = z.object({
  type: z.literal('cross_section'),
  schedule: z.enum(['daily', 'weekly', 'monthly']),
  universe: z.object({ filters: z.array(universeFilterSchema) }),
  score: exprSchema,
  factors: z.array(z.string()).optional(),
  pick: z.object({ side: z.enum(['high', 'low']), quantile: z.number().gt(0).max(1) }),
  weight: z.literal('equal'),
});

/** A strategy IR (the union grows as new archetypes are added). */
export const strategySchema = crossSectionSchema;

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
