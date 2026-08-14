import type {
  DistributionComparisonPlanSpecV1,
  EventStudyPlanSpecV1,
  MultivariateTimeSeriesPlanSpecV1,
  ResearchMeasureDefinitionV1,
  ResearchPlanSpecV1,
  ResearchSeriesInputSpecV1,
  ResearchUniverseInputSpecV1,
  TimeSeriesRelationshipPlanSpecV1,
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

const universeInputSchema = z.strictObject({
  type: z.literal('universe'),
  id: idSchema,
  universe: universeSpecV1Schema,
  measure: z.strictObject({
    measure: z.string().min(1).max(80),
    measureVersion: z.literal(1),
  }),
  label: z.string().trim().min(1).max(80).optional(),
}) satisfies z.ZodType<ResearchUniverseInputSpecV1>;

const timeSeriesQuestionSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('time_series_relationship'),
  text: z.string().trim().min(1).max(500),
  hypothesis: z.strictObject({
    estimand: z.literal('regression_slope'),
    direction: z.enum(['positive', 'negative', 'two_sided']),
    nullValue: z.literal(0),
  }),
});

const multivariateTimeSeriesQuestionSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('multivariate_time_series_relationship'),
  text: z.string().trim().min(1).max(500),
  hypothesis: z.strictObject({
    estimand: z.literal('partial_regression_coefficient'),
    focalPredictor: idSchema,
    direction: z.enum(['positive', 'negative', 'two_sided']),
    nullValue: z.literal(0),
  }),
});

const distributionQuestionSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('distribution_comparison'),
  text: z.string().trim().min(1).max(500),
  hypothesis: z.strictObject({
    estimand: z.literal('mean_difference'),
    direction: z.enum(['group_a_higher', 'group_a_lower', 'two_sided']),
    nullValue: z.literal(0),
  }),
});

const eventStudyQuestionSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('event_study'),
  text: z.string().trim().min(1).max(500),
  hypothesis: z.strictObject({
    estimand: z.literal('mean_cumulative_abnormal_return'),
    direction: z.enum(['positive', 'negative', 'two_sided']),
    nullValue: z.literal(0),
  }),
});

const timeSeriesProtocolSchema = z.strictObject({
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

const multivariateTimeSeriesProtocolSchema = z.strictObject({
  kind: z.literal('multivariate_time_series_relationship'),
  version: z.literal(1),
  outcome: idSchema,
  predictors: z
    .array(
      z.strictObject({
        input: idSchema,
        role: z.enum(['focal', 'control']),
        lag: z.number().int().min(0).max(120),
      }),
    )
    .min(2)
    .max(8),
  inference: z.strictObject({
    kind: z.literal('newey_west'),
    lag: z.union([z.literal('automatic'), z.number().int().min(0).max(120)]),
  }),
  rollingWindow: z.number().int().min(24).max(1200).optional(),
});

const distributionProtocolSchema = z.strictObject({
  kind: z.literal('distribution_comparison'),
  version: z.literal(1),
  groupA: idSchema,
  groupB: idSchema,
  measure: z.strictObject({
    measure: z.string().min(1).max(80),
    measureVersion: z.literal(1),
  }),
  inference: z.strictObject({ kind: z.literal('welch'), confidenceLevel: z.literal(0.95) }),
  sensitivity: z.strictObject({
    kind: z.literal('winsorized_mean'),
    tailFraction: z.number().min(0.01).max(0.2),
  }),
});

const eventSetInputSchema = z.strictObject({
  type: z.literal('event_set'),
  id: idSchema,
  source: z.strictObject({
    kind: z.literal('dividend_proposal_announcement'),
    entities: z.array(entityRefSchema).min(1).max(500),
  }),
  label: z.string().trim().min(1).max(80).optional(),
});

const eventStudyProtocolSchema = z.strictObject({
  kind: z.literal('event_study'),
  version: z.literal(1),
  eventSet: idSchema,
  benchmark: idSchema,
  eventWindow: z.strictObject({
    start: z.number().int().min(-60).max(0),
    end: z.number().int().min(0).max(60),
  }),
  returnModel: z.literal('market_adjusted'),
  overlappingEvents: z.literal('keep_first'),
  inference: z.strictObject({
    kind: z.literal('event_cluster_mean'),
    clusterBy: z.literal('event_trade_date'),
    confidenceLevel: z.literal(0.95),
  }),
});

const outputSchema = z.strictObject({
  kind: z.enum([
    'summary_table',
    'scatter',
    'rolling_relationship',
    'coefficient_plot',
    'partial_regression',
    'correlation_matrix',
    'rolling_coefficients',
    'distribution_boxplot',
    'sensitivity',
    'event_path',
    'event_table',
    'conclusion',
    'formula',
    'python_example',
    'documentation',
  ]),
});

const timeSeriesPlanSchema = z.strictObject({
  version: z.literal(1),
  question: timeSeriesQuestionSchema,
  start: dateSchema,
  end: dateSchema,
  universe: universeSpecV1Schema.optional(),
  inputs: z.array(seriesInputSchema).min(2).max(6),
  alignment: z.strictObject({
    frequency: z.enum(['daily', 'monthly']),
    join: z.literal('inner'),
    partialPeriod: z.enum(['exclude', 'include']),
  }),
  protocol: timeSeriesProtocolSchema,
  outputs: z.array(outputSchema).min(1).max(9),
}) satisfies z.ZodType<TimeSeriesRelationshipPlanSpecV1>;

const multivariateTimeSeriesPlanSchema = z.strictObject({
  version: z.literal(1),
  question: multivariateTimeSeriesQuestionSchema,
  start: dateSchema,
  end: dateSchema,
  inputs: z.array(seriesInputSchema).min(3).max(9),
  alignment: z.strictObject({
    frequency: z.enum(['daily', 'monthly']),
    join: z.literal('inner'),
    partialPeriod: z.enum(['exclude', 'include']),
  }),
  protocol: multivariateTimeSeriesProtocolSchema,
  outputs: z.array(outputSchema).min(1).max(13),
}) satisfies z.ZodType<MultivariateTimeSeriesPlanSpecV1>;

const distributionPlanSchema = z.strictObject({
  version: z.literal(1),
  question: distributionQuestionSchema,
  inputs: z.array(universeInputSchema).length(2),
  protocol: distributionProtocolSchema,
  outputs: z.array(outputSchema).min(1).max(9),
}) satisfies z.ZodType<DistributionComparisonPlanSpecV1>;

const eventStudyPlanSchema = z.strictObject({
  version: z.literal(1),
  question: eventStudyQuestionSchema,
  start: dateSchema,
  end: dateSchema,
  inputs: z.tuple([eventSetInputSchema, seriesInputSchema]),
  protocol: eventStudyProtocolSchema,
  outputs: z.array(outputSchema).min(1).max(11),
}) satisfies z.ZodType<EventStudyPlanSpecV1>;

export const researchPlanSpecV1Schema = z.union([
  timeSeriesPlanSchema,
  multivariateTimeSeriesPlanSchema,
  distributionPlanSchema,
  eventStudyPlanSchema,
]) satisfies z.ZodType<ResearchPlanSpecV1>;

export function parseResearchPlanSpec(input: unknown): ResearchPlanSpecV1 {
  const plan = researchPlanSpecV1Schema.parse(input);
  const errors = validateResearchPlanSemantics(plan);
  if (errors.length > 0) {
    throw new Error(`Invalid research plan: ${errors.join('; ')}`);
  }
  return plan;
}

export function validateResearchPlanSemantics(plan: ResearchPlanSpecV1): string[] {
  return isTimeSeriesPlan(plan)
    ? validateTimeSeriesPlan(plan)
    : isMultivariateTimeSeriesPlan(plan)
      ? validateMultivariateTimeSeriesPlan(plan)
      : isDistributionPlan(plan)
        ? validateDistributionPlan(plan)
        : validateEventStudyPlan(plan);
}

function isTimeSeriesPlan(plan: ResearchPlanSpecV1): plan is TimeSeriesRelationshipPlanSpecV1 {
  return plan.protocol.kind === 'time_series_relationship';
}

function isDistributionPlan(plan: ResearchPlanSpecV1): plan is DistributionComparisonPlanSpecV1 {
  return plan.protocol.kind === 'distribution_comparison';
}

function isMultivariateTimeSeriesPlan(
  plan: ResearchPlanSpecV1,
): plan is MultivariateTimeSeriesPlanSpecV1 {
  return plan.protocol.kind === 'multivariate_time_series_relationship';
}

function validateTimeSeriesPlan(plan: TimeSeriesRelationshipPlanSpecV1): string[] {
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

function validateMultivariateTimeSeriesPlan(plan: MultivariateTimeSeriesPlanSpecV1): string[] {
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
  const predictorIds = plan.protocol.predictors.map((predictor) => predictor.input);
  for (const predictorId of predictorIds) {
    if (!ids.has(predictorId)) {
      errors.push(`unknown predictor input ${predictorId}`);
    }
  }
  if (!ids.has(plan.protocol.outcome)) {
    errors.push(`unknown outcome input ${plan.protocol.outcome}`);
  }
  if (predictorIds.includes(plan.protocol.outcome)) {
    errors.push('outcome must not also be a predictor');
  }
  if (new Set(predictorIds).size !== predictorIds.length) {
    errors.push('predictors must not contain duplicate inputs');
  }
  const focalPredictors = plan.protocol.predictors.filter(
    (predictor) => predictor.role === 'focal',
  );
  if (focalPredictors.length !== 1) {
    errors.push('protocol must define exactly one focal predictor');
  }
  if (!plan.protocol.predictors.some((predictor) => predictor.role === 'control')) {
    errors.push('protocol must define at least one control predictor');
  }
  if (plan.question.hypothesis.focalPredictor !== focalPredictors[0]?.input) {
    errors.push('question focal predictor must match the protocol focal predictor');
  }
  if (ids.size !== predictorIds.length + 1) {
    errors.push('inputs must contain exactly the outcome and declared predictors');
  }
  if (new Set(plan.outputs.map((output) => output.kind)).size !== plan.outputs.length) {
    errors.push('outputs must not contain duplicates');
  }
  for (const required of [
    'summary_table',
    'coefficient_plot',
    'partial_regression',
    'correlation_matrix',
    'conclusion',
    'formula',
    'python_example',
    'documentation',
  ]) {
    if (!plan.outputs.some((output) => output.kind === required)) {
      errors.push(`outputs must include ${required}`);
    }
  }
  if (
    plan.protocol.rollingWindow != null &&
    !plan.outputs.some((output) => output.kind === 'rolling_coefficients')
  ) {
    errors.push('outputs must include rolling_coefficients when rollingWindow is set');
  }
  if (!researchProtocolById.has(plan.protocol.kind)) {
    errors.push(`unknown protocol ${plan.protocol.kind}`);
  }
  return errors;
}

function validateDistributionPlan(plan: DistributionComparisonPlanSpecV1): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const input of plan.inputs) {
    if (ids.has(input.id)) {
      errors.push(`duplicate input id ${input.id}`);
    }
    ids.add(input.id);
    const measure = researchUniverseMeasureById.get(input.measure.measure);
    if (!measure) {
      errors.push(`unknown universe measure ${input.measure.measure}`);
    }
    if (
      !input.universe.select.some(
        (selected) =>
          selected.measure === input.measure.measure &&
          selected.measureVersion === input.measure.measureVersion,
      )
    ) {
      errors.push(`input ${input.id} must select comparison measure ${input.measure.measure}`);
    }
    if (input.universe.asOf.kind === 'periodic') {
      errors.push(`input ${input.id} requires a fixed or latest_available asOf`);
    }
    if (input.universe.limit != null) {
      errors.push(`input ${input.id} must not truncate the comparison universe with limit`);
    }
  }
  if (!ids.has(plan.protocol.groupA)) {
    errors.push(`unknown group A input ${plan.protocol.groupA}`);
  }
  if (!ids.has(plan.protocol.groupB)) {
    errors.push(`unknown group B input ${plan.protocol.groupB}`);
  }
  if (plan.protocol.groupA === plan.protocol.groupB) {
    errors.push('group A and group B must be different inputs');
  }
  for (const input of plan.inputs) {
    if (
      input.measure.measure !== plan.protocol.measure.measure ||
      input.measure.measureVersion !== plan.protocol.measure.measureVersion
    ) {
      errors.push(`input ${input.id} measure must match the protocol measure`);
    }
  }
  if (!sameComparisonAsOf(plan.inputs[0]!.universe, plan.inputs[1]!.universe)) {
    errors.push('distribution groups must use the same requested as-of time');
  }
  if (new Set(plan.outputs.map((output) => output.kind)).size !== plan.outputs.length) {
    errors.push('outputs must not contain duplicates');
  }
  for (const required of ['summary_table', 'distribution_boxplot', 'sensitivity', 'conclusion']) {
    if (!plan.outputs.some((output) => output.kind === required)) {
      errors.push(`outputs must include ${required}`);
    }
  }
  return errors;
}

function validateEventStudyPlan(plan: EventStudyPlanSpecV1): string[] {
  const errors: string[] = [];
  if (plan.start > plan.end) {
    errors.push('start must not be after end');
  }
  const [eventSet, benchmark] = plan.inputs;
  if (plan.protocol.eventSet !== eventSet.id) {
    errors.push(`unknown event-set input ${plan.protocol.eventSet}`);
  }
  if (plan.protocol.benchmark !== benchmark.id) {
    errors.push(`unknown benchmark input ${plan.protocol.benchmark}`);
  }
  if (eventSet.source.entities.some((entity) => entity.assetType !== 'stock')) {
    errors.push('dividend proposal events support stock entities only');
  }
  if (
    benchmark.source.kind !== 'instrument' ||
    !['index', 'etf'].includes(benchmark.source.assetType)
  ) {
    errors.push('event-study benchmark must be an index or ETF instrument');
  }
  if (benchmark.measure !== 'market.adjusted_close' || benchmark.transform !== 'simple_return') {
    errors.push('event-study benchmark must use market.adjusted_close simple_return');
  }
  if (plan.protocol.eventWindow.start >= plan.protocol.eventWindow.end) {
    errors.push('event window start must be before end');
  }
  if (new Set(plan.outputs.map((output) => output.kind)).size !== plan.outputs.length) {
    errors.push('outputs must not contain duplicates');
  }
  for (const required of [
    'summary_table',
    'event_path',
    'event_table',
    'sensitivity',
    'conclusion',
  ]) {
    if (!plan.outputs.some((output) => output.kind === required)) {
      errors.push(`outputs must include ${required}`);
    }
  }
  return errors;
}

function sameComparisonAsOf(left: UniverseSpecV1, right: UniverseSpecV1): boolean {
  if (left.asOf.kind !== right.asOf.kind) {
    return false;
  }
  return (
    left.asOf.kind !== 'fixed' ||
    (right.asOf.kind === 'fixed' && left.asOf.date === right.asOf.date)
  );
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
