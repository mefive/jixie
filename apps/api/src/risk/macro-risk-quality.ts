import { MACRO_RISK_AXIS_KEYS_V1, type MacroRiskAxisKeyV1 } from '@jixie/shared';
import { prisma, type Prisma } from '../lib/prisma.js';
import { loadMacroRiskAxisHistory, type MacroRiskAxisHistoryV1 } from './macro-risk-axes.js';
import { MACRO_RISK_MINIMUM_OBSERVATIONS } from './macro-risk-model.js';

export interface MacroRiskAxisQualityAxis {
  axis: MacroRiskAxisKeyV1;
  exploratoryObservations: number;
  strictObservations: number;
  latestExploratoryDate: string | null;
}

export interface MacroRiskAxisQualitySummary {
  status: 'pass' | 'warn' | 'error';
  expectedMonths: number;
  exploratoryCompleteObservations: number;
  strictCompleteObservations: number;
  latestExploratoryCompleteDate: string | null;
  axes: MacroRiskAxisQualityAxis[];
  errors: string[];
  warnings: string[];
}

export async function auditMacroRiskAxes(
  options: { startDate: string; endDate: string },
  database: Prisma = prisma,
): Promise<MacroRiskAxisQualitySummary> {
  const eligibleStart = options.startDate > '20180326' ? options.startDate : '20180326';
  const [exploratory, strict] = await Promise.all([
    loadMacroRiskAxisHistory(
      {
        startDate: eligibleStart,
        endDate: options.endDate,
        revisionPolicy: 'latest_vintage',
      },
      database,
    ),
    loadMacroRiskAxisHistory(
      {
        startDate: eligibleStart,
        endDate: options.endDate,
        revisionPolicy: 'as_available',
      },
      database,
    ),
  ]);
  return summarizeMacroRiskAxisQuality(exploratory, strict);
}

export function summarizeMacroRiskAxisQuality(
  exploratory: MacroRiskAxisHistoryV1,
  strict: MacroRiskAxisHistoryV1,
): MacroRiskAxisQualitySummary {
  const exploratoryComplete = completeObservations(exploratory);
  const strictComplete = completeObservations(strict);
  const axes = MACRO_RISK_AXIS_KEYS_V1.map((axis): MacroRiskAxisQualityAxis => {
    const exploratoryDates = availableDates(exploratory, axis);
    return {
      axis,
      exploratoryObservations: exploratoryDates.length,
      strictObservations: availableDates(strict, axis).length,
      latestExploratoryDate: exploratoryDates.at(-1) ?? null,
    };
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  if (exploratory.lineage.pointInTimeEligible) {
    errors.push('latest-vintage macro exploration is incorrectly labeled point-in-time eligible');
  }
  if (!strict.lineage.pointInTimeEligible || strict.lineage.futureVintageRows !== 0) {
    errors.push('strict macro-axis lineage violates the as-available gate');
  }
  if (exploratoryComplete.length < MACRO_RISK_MINIMUM_OBSERVATIONS) {
    errors.push(
      `only ${exploratoryComplete.length} complete exploratory macro-axis changes are available`,
    );
  }
  const insufficientAxes = axes.filter(
    (axis) => axis.exploratoryObservations < MACRO_RISK_MINIMUM_OBSERVATIONS,
  );
  if (insufficientAxes.length > 0) {
    errors.push(
      `insufficient exploratory axes: ${insufficientAxes.map((axis) => axis.axis).join(', ')}`,
    );
  }
  if (strictComplete.length < MACRO_RISK_MINIMUM_OBSERVATIONS) {
    warnings.push(
      `strict PIT history has ${strictComplete.length}/${MACRO_RISK_MINIMUM_OBSERVATIONS} required complete observations while local vintages accumulate`,
    );
  }
  return {
    status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'pass',
    expectedMonths: exploratory.states.length,
    exploratoryCompleteObservations: exploratoryComplete.length,
    strictCompleteObservations: strictComplete.length,
    latestExploratoryCompleteDate: exploratoryComplete.at(-1)?.date ?? null,
    axes,
    errors,
    warnings,
  };
}

function completeObservations(history: MacroRiskAxisHistoryV1) {
  return history.observations.filter((observation) =>
    MACRO_RISK_AXIS_KEYS_V1.every((axis) => observation.values[axis] != null),
  );
}

function availableDates(history: MacroRiskAxisHistoryV1, axis: MacroRiskAxisKeyV1): string[] {
  return history.observations
    .filter((observation) => observation.values[axis] != null)
    .map((observation) => observation.date);
}
