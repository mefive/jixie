import type { ResearchRunResultV1, ResearchSeriesCoverageV1 } from '@jixie/shared';
import { researchProtocolById } from './catalog.js';
import { concludeTimeSeriesRelationship } from './conclusion.js';
import { parseResearchPlanSpec } from './spec.js';
import {
  loadResearchSeries,
  prepareResearchSeries,
  researchSeriesLoadStart,
  type ResearchSeriesLoader,
  type ResearchSeriesPoint,
} from './series.js';
import { evaluateTimeSeriesRelationship } from './time-series-relationship.js';

export interface ExecuteResearchPlanOptions {
  loadSeries?: ResearchSeriesLoader;
}

export async function executeResearchPlan(
  input: unknown,
  options: ExecuteResearchPlanOptions = {},
): Promise<ResearchRunResultV1> {
  const plan = parseResearchPlanSpec(input);
  const protocolDefinition = researchProtocolById.get(plan.protocol.kind);
  if (!protocolDefinition) {
    throw new Error(`Research protocol ${plan.protocol.kind} is not registered.`);
  }
  const loader = options.loadSeries ?? loadResearchSeries;
  const prepared = new Map<string, ResearchSeriesPoint[]>();
  const coverage: ResearchSeriesCoverageV1[] = [];
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
  };
}
