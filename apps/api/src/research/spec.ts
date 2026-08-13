import type {
  ResearchMeasureDefinitionV1,
  ResearchPlanSpecV1,
  ResearchSeriesInputSpecV1,
  UniverseSpecV1,
} from '@jixie/shared';
import { z } from 'zod';
import {
  researchMeasureById,
  researchProtocolById,
  researchUniverseMeasureById,
} from './catalog.js';

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

const seriesSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('instrument'),
    assetType: z.enum(['stock', 'etf', 'index', 'future']),
    id: objectIdSchema,
  }),
  z.strictObject({ kind: z.literal('macro'), seriesKey: objectIdSchema }),
  z.strictObject({
    kind: z.literal('yield_curve'),
    curveCode: objectIdSchema,
    curveType: objectIdSchema,
    termYears: z.number().positive().max(100),
  }),
  z.strictObject({ kind: z.literal('fx'), id: objectIdSchema }),
]);

const seriesInputSchema = z.strictObject({
  type: z.literal('series'),
  id: idSchema,
  source: seriesSourceSchema,
  measure: z.string().min(1).max(80),
  transform: z.enum(['level', 'difference', 'simple_return', 'percent_change', 'year_over_year']),
  label: z.string().trim().min(1).max(80).optional(),
}) satisfies z.ZodType<ResearchSeriesInputSpecV1>;

const researchQuestionSpecV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('time_series_relationship'),
    text: z.string().trim().min(1).max(500),
    hypothesis: z.strictObject({
      estimand: z.literal('regression_slope'),
      direction: z.enum(['positive', 'negative', 'two_sided']),
      nullValue: z.literal(0),
    }),
  }),
]);

const protocolSchema = z.strictObject({
  kind: z.literal('time_series_relationship'),
  version: z.literal(1),
  predictor: idSchema,
  outcome: idSchema,
  predictorLag: z.number().int().min(0).max(120),
  correlations: z
    .array(z.enum(['pearson', 'spearman']))
    .min(1)
    .max(2),
  inference: z.strictObject({
    kind: z.literal('newey_west'),
    lag: z.union([z.literal('automatic'), z.number().int().min(0).max(120)]),
  }),
  rollingWindow: z.number().int().min(12).max(1200).optional(),
});

const outputSchema = z.strictObject({
  kind: z.enum([
    'summary_table',
    'scatter',
    'rolling_relationship',
    'conclusion',
    'formula',
    'python_example',
    'documentation',
  ]),
});

export const researchPlanSpecV1Schema = z.strictObject({
  version: z.literal(1),
  question: researchQuestionSpecV1Schema,
  start: dateSchema,
  end: dateSchema,
  universe: universeSpecV1Schema.optional(),
  inputs: z.array(seriesInputSchema).min(2).max(6),
  alignment: z.strictObject({
    frequency: z.enum(['daily', 'monthly']),
    join: z.literal('inner'),
    partialPeriod: z.enum(['exclude', 'include']),
  }),
  protocol: protocolSchema,
  outputs: z.array(outputSchema).min(1).max(7),
}) satisfies z.ZodType<ResearchPlanSpecV1>;

export function parseResearchPlanSpec(input: unknown): ResearchPlanSpecV1 {
  const plan = researchPlanSpecV1Schema.parse(input);
  const errors = validateResearchPlanSemantics(plan);
  if (errors.length > 0) {
    throw new Error(`Invalid research plan: ${errors.join('; ')}`);
  }
  return plan;
}

export function validateResearchPlanSemantics(plan: ResearchPlanSpecV1): string[] {
  const errors: string[] = [];
  if (plan.start > plan.end) {
    errors.push('start must not be after end');
  }

  const ids = new Set<string>();
  for (const input of plan.inputs) {
    if (ids.has(input.id)) {
      errors.push(`duplicate input id ${input.id}`);
    }
    ids.add(input.id);
    validateInput(input, errors);
  }

  if (!ids.has(plan.protocol.predictor)) {
    errors.push(`unknown predictor input ${plan.protocol.predictor}`);
  }
  if (!ids.has(plan.protocol.outcome)) {
    errors.push(`unknown outcome input ${plan.protocol.outcome}`);
  }
  if (plan.protocol.predictor === plan.protocol.outcome) {
    errors.push('predictor and outcome must be different inputs');
  }
  if (new Set(plan.protocol.correlations).size !== plan.protocol.correlations.length) {
    errors.push('correlations must not contain duplicates');
  }
  if (new Set(plan.outputs.map((output) => output.kind)).size !== plan.outputs.length) {
    errors.push('outputs must not contain duplicates');
  }
  if (!researchProtocolById.has(plan.protocol.kind)) {
    errors.push(`unknown protocol ${plan.protocol.kind}`);
  }
  if (plan.question.kind !== plan.protocol.kind) {
    errors.push(
      `question kind ${plan.question.kind} does not match protocol ${plan.protocol.kind}`,
    );
  }
  if (!plan.outputs.some((output) => output.kind === 'conclusion')) {
    errors.push('outputs must include conclusion');
  }
  if (plan.universe) {
    errors.push('time_series_relationship does not accept a universe input');
  }
  return errors;
}

function validateInput(input: ResearchSeriesInputSpecV1, errors: string[]): void {
  const measure = researchMeasureById.get(input.measure);
  if (!measure) {
    errors.push(`unknown measure ${input.measure}`);
    return;
  }
  if (!measure.sourceKinds.includes(input.source.kind)) {
    errors.push(`measure ${input.measure} does not support source ${input.source.kind}`);
  }
  if (!measure.transforms.includes(input.transform)) {
    errors.push(`measure ${input.measure} does not support transform ${input.transform}`);
  }
  validateAssetType(input, measure, errors);
}

function validateAssetType(
  input: ResearchSeriesInputSpecV1,
  measure: ResearchMeasureDefinitionV1,
  errors: string[],
): void {
  if (
    input.source.kind === 'instrument' &&
    measure.assetTypes &&
    !measure.assetTypes.includes(input.source.assetType)
  ) {
    errors.push(`measure ${input.measure} does not support asset type ${input.source.assetType}`);
  }
}
