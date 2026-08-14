import type { PrismaClient } from '@prisma/client';
import type {
  DistributionComparisonPlanSpecV1,
  DistributionComparisonRunResultV1,
  EventStudyPlanSpecV1,
  EventStudyRunResultV1,
  MultivariateTimeSeriesPlanSpecV1,
  MultivariateTimeSeriesRunResultV1,
  ResearchDistributionObservationV1,
  ResearchPlanSpecV1,
  ResearchRunResultV1,
  ResearchSeriesCoverageV1,
  ResearchUniverseRunResultV1,
  TimeSeriesRelationshipPlanSpecV1,
  TimeSeriesRelationshipRunResultV1,
} from '@jixie/shared';
import { researchProtocolById, researchUniverseMeasureById } from './catalog.js';
import { concludeTimeSeriesRelationship } from './conclusion.js';
import { concludeDistributionComparison } from './distribution-conclusion.js';
import { evaluateDistributionComparison } from './distribution-comparison.js';
import { concludeEventStudy } from './event-study-conclusion.js';
import { executeEventStudy } from './event-study.js';
import { researchDataInputFingerprint, researchRunFingerprints } from './fingerprints.js';
import { parseResearchPlanSpec } from './spec.js';
import {
  loadResearchSeries,
  prepareResearchSeries,
  researchSeriesLoadStart,
  type ResearchSeriesLoader,
  type ResearchSeriesPoint,
} from './series.js';
import { evaluateTimeSeriesRelationship } from './time-series-relationship.js';
import { concludeMultivariateTimeSeriesRelationship } from './multivariate-conclusion.js';
import { evaluateMultivariateTimeSeriesRelationship } from './multivariate-time-series.js';
import { executeUniverseSpec } from './universe.js';

export type ResearchUniverseExecutor = (input: unknown) => Promise<ResearchUniverseRunResultV1>;

export interface ExecuteResearchPlanOptions {
  loadSeries?: ResearchSeriesLoader;
  executeUniverse?: ResearchUniverseExecutor;
  database?: PrismaClient;
}

export function executeResearchPlan(
  input: TimeSeriesRelationshipPlanSpecV1,
  options?: ExecuteResearchPlanOptions,
): Promise<TimeSeriesRelationshipRunResultV1>;
export function executeResearchPlan(
  input: MultivariateTimeSeriesPlanSpecV1,
  options?: ExecuteResearchPlanOptions,
): Promise<MultivariateTimeSeriesRunResultV1>;
export function executeResearchPlan(
  input: DistributionComparisonPlanSpecV1,
  options?: ExecuteResearchPlanOptions,
): Promise<DistributionComparisonRunResultV1>;
export function executeResearchPlan(
  input: EventStudyPlanSpecV1,
  options?: ExecuteResearchPlanOptions,
): Promise<EventStudyRunResultV1>;
export function executeResearchPlan(
  input: ResearchPlanSpecV1,
  options?: ExecuteResearchPlanOptions,
): Promise<ResearchRunResultV1>;
export function executeResearchPlan(
  input: unknown,
  options?: ExecuteResearchPlanOptions,
): Promise<ResearchRunResultV1>;
export async function executeResearchPlan(
  input: unknown,
  options: ExecuteResearchPlanOptions = {},
): Promise<ResearchRunResultV1> {
  const plan = parseResearchPlanSpec(input);
  return isTimeSeriesPlan(plan)
    ? executeTimeSeriesPlan(plan, options)
    : isMultivariateTimeSeriesPlan(plan)
      ? executeMultivariateTimeSeriesPlan(plan, options)
      : isDistributionPlan(plan)
        ? executeDistributionPlan(plan, options)
        : executeEventStudyPlan(plan, options);
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

async function executeTimeSeriesPlan(
  plan: TimeSeriesRelationshipPlanSpecV1,
  options: ExecuteResearchPlanOptions,
): Promise<TimeSeriesRelationshipRunResultV1> {
  const protocolDefinition = researchProtocolById.get(plan.protocol.kind);
  if (!protocolDefinition) {
    throw new Error(`Research protocol ${plan.protocol.kind} is not registered.`);
  }
  const loader = options.loadSeries ?? loadResearchSeries;
  const prepared = new Map<string, ResearchSeriesPoint[]>();
  const coverage: ResearchSeriesCoverageV1[] = [];
  const dataFingerprints = [];
  const diagnostics = [];

  for (const seriesInput of plan.inputs) {
    const loaded = await loader(
      seriesInput,
      researchSeriesLoadStart(plan.start, plan.alignment.frequency, seriesInput.transform),
      plan.end,
    );
    const points = prepareResearchSeries(
      loaded.points,
      plan.alignment.frequency,
      seriesInput.transform,
      {
        start: plan.start,
        end: plan.end,
        partialPeriod: plan.alignment.partialPeriod,
      },
    );
    prepared.set(seriesInput.id, points);
    dataFingerprints.push(
      researchDataInputFingerprint({
        inputId: seriesInput.id,
        payload: { loaded: loaded.points, prepared: points },
        observations: points.length,
        firstDate: points[0]?.date ?? null,
        lastDate: points.at(-1)?.date ?? null,
      }),
    );
    diagnostics.push(...loaded.diagnostics);
    coverage.push({
      inputId: seriesInput.id,
      observationsLoaded: points.length,
      observationsAligned: 0,
      firstDate: points[0]?.date ?? null,
      lastDate: points.at(-1)?.date ?? null,
      missingAfterAlignment: 0,
    });
  }

  const predictor = prepared.get(plan.protocol.predictor)!;
  const outcome = prepared.get(plan.protocol.outcome)!;
  const evaluation = evaluateTimeSeriesRelationship(
    plan.protocol,
    predictor,
    outcome,
    protocolDefinition.minimumObservations,
  );
  const aligned = evaluation.result.observations;
  for (const item of coverage) {
    item.observationsAligned = aligned;
    item.missingAfterAlignment = Math.max(0, item.observationsLoaded - aligned);
  }
  const allDiagnostics = [...diagnostics, ...evaluation.diagnostics];
  const conclusion = concludeTimeSeriesRelationship(
    plan.question,
    evaluation.result,
    allDiagnostics,
  );

  return {
    version: 1,
    plan,
    protocol: protocolDefinition,
    coverage,
    result: evaluation.result,
    conclusion,
    diagnostics: allDiagnostics,
    fingerprints: researchRunFingerprints(protocolDefinition, dataFingerprints),
  };
}

async function executeMultivariateTimeSeriesPlan(
  plan: MultivariateTimeSeriesPlanSpecV1,
  options: ExecuteResearchPlanOptions,
): Promise<MultivariateTimeSeriesRunResultV1> {
  const protocolDefinition = researchProtocolById.get(plan.protocol.kind);
  if (!protocolDefinition) {
    throw new Error(`Research protocol ${plan.protocol.kind} is not registered.`);
  }
  const loader = options.loadSeries ?? loadResearchSeries;
  const prepared = new Map<string, ResearchSeriesPoint[]>();
  const coverage: ResearchSeriesCoverageV1[] = [];
  const dataFingerprints = [];
  const diagnostics = [];

  for (const seriesInput of plan.inputs) {
    const loaded = await loader(
      seriesInput,
      researchSeriesLoadStart(plan.start, plan.alignment.frequency, seriesInput.transform),
      plan.end,
    );
    const points = prepareResearchSeries(
      loaded.points,
      plan.alignment.frequency,
      seriesInput.transform,
      {
        start: plan.start,
        end: plan.end,
        partialPeriod: plan.alignment.partialPeriod,
      },
    );
    prepared.set(seriesInput.id, points);
    dataFingerprints.push(
      researchDataInputFingerprint({
        inputId: seriesInput.id,
        payload: { loaded: loaded.points, prepared: points },
        observations: points.length,
        firstDate: points[0]?.date ?? null,
        lastDate: points.at(-1)?.date ?? null,
      }),
    );
    diagnostics.push(...loaded.diagnostics);
    coverage.push({
      inputId: seriesInput.id,
      observationsLoaded: points.length,
      observationsAligned: 0,
      firstDate: points[0]?.date ?? null,
      lastDate: points.at(-1)?.date ?? null,
      missingAfterAlignment: 0,
    });
  }

  const evaluation = evaluateMultivariateTimeSeriesRelationship(
    plan.protocol,
    prepared,
    protocolDefinition.minimumObservations,
  );
  for (const item of coverage) {
    item.observationsAligned = evaluation.result.observations;
    item.missingAfterAlignment = Math.max(
      0,
      item.observationsLoaded - evaluation.result.observations,
    );
  }
  const allDiagnostics = [...diagnostics, ...evaluation.diagnostics];
  return {
    version: 1,
    plan,
    protocol: protocolDefinition,
    coverage,
    result: evaluation.result,
    conclusion: concludeMultivariateTimeSeriesRelationship(
      plan.question,
      evaluation.result,
      allDiagnostics,
    ),
    diagnostics: allDiagnostics,
    fingerprints: researchRunFingerprints(protocolDefinition, dataFingerprints),
  };
}

async function executeDistributionPlan(
  plan: DistributionComparisonPlanSpecV1,
  options: ExecuteResearchPlanOptions,
): Promise<DistributionComparisonRunResultV1> {
  const protocolDefinition = researchProtocolById.get(plan.protocol.kind);
  const measure = researchUniverseMeasureById.get(plan.protocol.measure.measure);
  if (!protocolDefinition || !measure) {
    throw new Error('Distribution comparison protocol or measure is not registered.');
  }
  const universeExecutor =
    options.executeUniverse ??
    ((spec: unknown) => executeUniverseSpec(spec, undefined, { defaultLimit: null }));
  const universeRuns = await Promise.all(
    plan.inputs.map((universeInput) => universeExecutor(universeInput.universe)),
  );
  if (universeRuns[0]!.asOfDate !== universeRuns[1]!.asOfDate) {
    throw new Error('distribution groups did not resolve to the same as-of date');
  }
  const membersA = new Set(universeRuns[0]!.rows.map((row) => row.entity.id));
  const overlap = universeRuns[1]!.rows.filter((row) => membersA.has(row.entity.id));
  if (overlap.length > 0) {
    throw new Error(
      `distribution groups overlap by ${overlap.length} entities; define mutually exclusive groups`,
    );
  }

  const groupInputs = plan.inputs.map((universeInput, index) => {
    const universeRun = universeRuns[index]!;
    const observations: ResearchDistributionObservationV1[] = universeRun.rows.flatMap((row) => {
      const value = row.values[universeInput.measure.measure];
      return value == null || !Number.isFinite(value)
        ? []
        : [{ entity: row.entity, name: row.name, value }];
    });
    return {
      inputId: universeInput.id,
      label: universeInput.label ?? universeInput.id,
      observations,
    };
  });
  const evaluation = evaluateDistributionComparison(
    plan.protocol,
    measure,
    groupInputs[0]!,
    groupInputs[1]!,
    protocolDefinition.minimumObservations,
  );
  const diagnostics = [
    ...universeRuns.flatMap((universeRun) => universeRun.diagnostics),
    ...evaluation.diagnostics,
  ];
  const coverage = plan.inputs.map((universeInput, index) => {
    const universeRun = universeRuns[index]!;
    const observationsValid = groupInputs[index]!.observations.length;
    return {
      inputId: universeInput.id,
      requestedAsOfDate: universeRun.requestedAsOfDate,
      asOfDate: universeRun.asOfDate,
      membershipAsOfDate: universeRun.membershipAsOfDate,
      membersResolved: universeRun.rows.length,
      observationsValid,
      missingMeasure: universeRun.rows.length - observationsValid,
      dataRevision: universeRun.dataRevision,
    };
  });
  const conclusion = concludeDistributionComparison(plan.question, evaluation.result, diagnostics);
  const dataFingerprints = plan.inputs.map((universeInput, index) => {
    const universeRun = universeRuns[index]!;
    const observations = groupInputs[index]!.observations;
    return researchDataInputFingerprint({
      inputId: universeInput.id,
      payload: {
        asOfDate: universeRun.asOfDate,
        membershipAsOfDate: universeRun.membershipAsOfDate,
        observations,
      },
      observations: observations.length,
      firstDate: universeRun.asOfDate,
      lastDate: universeRun.asOfDate,
      dataRevision: universeRun.dataRevision,
    });
  });

  return {
    version: 1,
    plan,
    protocol: protocolDefinition,
    coverage,
    result: evaluation.result,
    conclusion,
    diagnostics,
    fingerprints: researchRunFingerprints(protocolDefinition, dataFingerprints),
  };
}

async function executeEventStudyPlan(
  plan: EventStudyPlanSpecV1,
  options: ExecuteResearchPlanOptions,
): Promise<EventStudyRunResultV1> {
  const protocolDefinition = researchProtocolById.get(plan.protocol.kind);
  if (!protocolDefinition) {
    throw new Error('Event-study protocol is not registered.');
  }
  const execution = await executeEventStudy(
    plan,
    protocolDefinition.minimumObservations,
    options.database,
  );
  const conclusion = concludeEventStudy(plan.question, execution.result, execution.diagnostics);
  return {
    version: 1,
    plan,
    protocol: protocolDefinition,
    coverage: execution.coverage,
    result: execution.result,
    conclusion,
    diagnostics: execution.diagnostics,
    fingerprints: researchRunFingerprints(protocolDefinition, execution.dataFingerprints),
  };
}
