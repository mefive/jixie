import type { UniverseSpecV1 } from '@jixie/shared';
import { z } from 'zod';
import { researchUniverseMeasureById } from './catalog.js';

const dateSchema = z.string().regex(/^\d{8}$/, 'must use YYYYMMDD');
const idSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,29}$/);
const objectIdSchema = z.string().trim().min(1).max(120);

const entityRefSchema = z.strictObject({
  assetType: z.enum(['stock', 'etf', 'index', 'future']),
  id: objectIdSchema,
});

const universeSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('equity_market'), market: z.literal('CN') }),
  z.strictObject({ kind: z.literal('index_members'), indexCode: objectIdSchema }),
  z.strictObject({
    kind: z.literal('explicit'),
    entities: z.array(entityRefSchema).min(1).max(500),
  }),
]);

const universeAsOfSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), date: dateSchema }),
  z.strictObject({ kind: z.literal('latest_available') }),
  z.strictObject({ kind: z.literal('periodic'), frequency: z.literal('month_end') }),
]);

export const universeSpecV1Schema = z.strictObject({
  version: z.literal(1),
  source: universeSourceSchema,
  asOf: universeAsOfSchema,
  predicates: z
    .array(
      z.strictObject({
        measure: z.string().min(1).max(80),
        measureVersion: z.literal(1),
        op: z.enum(['>', '>=', '<', '<=', '==', '!=']),
        value: z.union([z.number().finite(), z.string().min(1).max(120)]),
      }),
    )
    .max(20),
  missing: z.literal('exclude'),
  eligibility: z.strictObject({
    minimumListedDays: z.number().int().min(0).max(36500),
    suspension: z.literal('exclude'),
    riskWarning: z.enum(['include', 'exclude']),
  }),
  sort: z
    .strictObject({
      measure: z.string().min(1).max(80),
      measureVersion: z.literal(1),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  select: z
    .array(z.strictObject({ measure: z.string().min(1).max(80), measureVersion: z.literal(1) }))
    .min(1)
    .max(20),
  limit: z.number().int().positive().max(5000).optional(),
}) satisfies z.ZodType<UniverseSpecV1>;

export function parseUniverseSpec(input: unknown): UniverseSpecV1 {
  const spec = universeSpecV1Schema.parse(input);
  const referenced = [
    ...spec.predicates.map((predicate) => predicate.measure),
    ...spec.select.map((measure) => measure.measure),
    ...(spec.sort ? [spec.sort.measure] : []),
  ];
  const unknown = [...new Set(referenced)].filter(
    (measure) => !researchUniverseMeasureById.has(measure),
  );
  if (unknown.length > 0) {
    throw new Error(`Invalid universe spec: unknown measure ${unknown.join(', ')}`);
  }
  const duplicateSelect = spec.select.find(
    (item, index) =>
      spec.select.findIndex((candidate) => candidate.measure === item.measure) !== index,
  );
  if (duplicateSelect) {
    throw new Error(`Invalid universe spec: duplicate selected measure ${duplicateSelect.measure}`);
  }
  if (spec.predicates.some((predicate) => typeof predicate.value !== 'number')) {
    throw new Error('Invalid universe spec: V1 universe measures require numeric predicate values');
  }
  return spec;
}
