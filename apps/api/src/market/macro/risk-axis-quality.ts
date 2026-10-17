import { MACRO_RISK_AXIS_KEYS_V1, type MacroRiskAxisKeyV1 } from '@jixie/shared';
import { prisma, type Prisma } from '#infra/database/prisma.js';
import { loadMacroRiskAxisHistory, type MacroRiskAxisHistoryV1 } from './risk-axes.js';

/**
 * 描述单风险轴的覆盖与可得性质量。
 *
 * Describe coverage and availability quality for one risk axis.
 */
export interface MacroRiskAxisQualityAxis {
  axis: MacroRiskAxisKeyV1;
  exploratoryObservations: number;
  strictObservations: number;
  latestExploratoryDate: string | null;
}

/**
 * 汇总全部风险轴的就绪状态与异常。
 *
 * Collect readiness and diagnostics across risk axes.
 */
export interface MacroRiskAxisQualitySummary {
  expectedMonths: number;
  exploratoryCompleteObservations: number;
  strictCompleteObservations: number;
  latestExploratoryCompleteDate: string | null;
  axes: MacroRiskAxisQualityAxis[];
  lineageErrors: string[];
}

export async function inspectMacroRiskAxes(
  options: { startDate: string; endDate: string },
  database: Prisma = prisma,
): Promise<MacroRiskAxisQualitySummary> {
  const [exploratory, strict] = await Promise.all([
    loadMacroRiskAxisHistory(
      {
        startDate: options.startDate,
        endDate: options.endDate,
        revisionPolicy: 'latest_vintage',
      },
      database,
    ),
    loadMacroRiskAxisHistory(
      {
        startDate: options.startDate,
        endDate: options.endDate,
        revisionPolicy: 'as_available',
      },
      database,
    ),
  ]);
  return summarizeMacroRiskAxisQuality(exploratory, strict);
}

/**
 * 检查风险轴样本、可得日期与缺口，汇总模型输入质量。
 *
 * Summarize risk-axis samples, availability and gaps for model input quality.
 */
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
  const lineageErrors: string[] = [];
  if (exploratory.lineage.pointInTimeEligible) {
    lineageErrors.push(
      'latest-vintage macro exploration is incorrectly labeled point-in-time eligible',
    );
  }
  if (!strict.lineage.pointInTimeEligible || strict.lineage.futureVintageRows !== 0) {
    lineageErrors.push('strict macro-axis lineage violates the as-available gate');
  }
  return {
    expectedMonths: exploratory.states.length,
    exploratoryCompleteObservations: exploratoryComplete.length,
    strictCompleteObservations: strictComplete.length,
    latestExploratoryCompleteDate: exploratoryComplete.at(-1)?.date ?? null,
    axes,
    lineageErrors,
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
