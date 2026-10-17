import type { EquityStyleControlExposureV1 } from '../../observations/contract.js';
import type {
  FactorAnalysisSpecV6,
  FactorFamaMacbethReportV1,
  FactorRobustInferenceV1,
} from '@jixie/shared';
import {
  automaticNeweyWestLag,
  leastSquaresCoefficients,
  neweyWestMeanInference,
  populationZScores,
} from '#math/inference.js';

export const FAMA_MACBETH_CONTROLS = ['size', 'value', 'momentum', 'quality'] as const;

/**
 * 承载单证券当期因子、目标收益与控制变量，供 Fama–MacBeth 回归。
 *
 * Supply a dated instrument's factor, target return and controls to Fama-MacBeth regression.
 */
export interface FamaMacbethCrossSectionRowV1 extends EquityStyleControlExposureV1 {
  candidate: number;
  forwardReturn: number;
}

/**
 * 记录单期截面回归的系数与样本诊断，供第二步时序汇总。
 *
 * Retain period regression coefficients and diagnostics for second-pass inference.
 */
export interface FamaMacbethPeriodEstimateV1 {
  coefficient: number;
  observations: number;
}

/**
 * 区分单期回归可用估计与不可估原因，避免缺样本被当作零。
 *
 * Distinguish usable period estimates from unavailability reasons.
 */
export interface FamaMacbethPeriodAttemptV1 {
  completeObservations: number;
  estimate: FamaMacbethPeriodEstimateV1 | null;
  collinear: boolean;
}

/**
 * 对单个截面拟合含冻结控制变量的 Fama–MacBeth 辅助回归，并保留样本诊断。
 *
 * Estimate one Fama-MacBeth cross-section with frozen controls and retain sample diagnostics.
 */
export function estimateFamaMacbethPeriod(
  rows: FamaMacbethCrossSectionRowV1[],
  minimumObservations: number,
): FamaMacbethPeriodAttemptV1 {
  if (rows.length < minimumObservations) {
    return { completeObservations: rows.length, estimate: null, collinear: false };
  }
  const columns = [
    rows.map((row) => row.candidate),
    rows.map((row) => row.size),
    rows.map((row) => row.value),
    rows.map((row) => row.momentum),
    rows.map((row) => row.quality),
  ].map(populationZScores);
  if (columns.some((column) => column == null)) {
    return { completeObservations: rows.length, estimate: null, collinear: true };
  }
  const standardized = columns as number[][];
  const design = rows.map((_, row) => [
    1,
    standardized[0]![row]!,
    standardized[1]![row]!,
    standardized[2]![row]!,
    standardized[3]![row]!,
    standardized[4]![row]!,
  ]);
  const coefficients = leastSquaresCoefficients(
    design,
    rows.map((row) => row.forwardReturn),
  );
  if (!coefficients) {
    return { completeObservations: rows.length, estimate: null, collinear: true };
  }
  return {
    completeObservations: rows.length,
    estimate: { coefficient: coefficients[1]!, observations: rows.length },
    collinear: false,
  };
}

/**
 * 汇总截面 IC 和逐期回归，生成时序稳健推断与覆盖限制。
 *
 * Combine IC and period regressions into robust time-series inference and coverage diagnostics.
 */
export function buildCrossSectionalRobustInference(input: {
  spec: FactorAnalysisSpecV6;
  rankIc: number[];
  equalGross: number[];
  equalNet: number[];
  mktcapGross: number[];
  mktcapNet: number[];
  famaMacbethAttempts: FamaMacbethPeriodAttemptV1[];
}): FactorRobustInferenceV1 {
  const infer = (values: number[]) =>
    neweyWestMeanInference(values, automaticNeweyWestLag(values.length)) ?? undefined;
  const estimates = input.famaMacbethAttempts.flatMap((attempt) =>
    attempt.estimate ? [attempt.estimate] : [],
  );
  const adequatePeriods = input.famaMacbethAttempts.filter(
    (attempt) =>
      attempt.completeObservations >= input.spec.inference.famaMacbeth.minimumObservationsPerPeriod,
  ).length;
  const coefficientInference =
    estimates.length >= input.spec.inference.famaMacbeth.minimumPeriods
      ? infer(estimates.map((estimate) => estimate.coefficient))
      : undefined;
  const famaMacbeth: FactorFamaMacbethReportV1 = {
    status: coefficientInference ? 'available' : 'unavailable',
    controlSet: input.spec.inference.famaMacbeth.controlSet,
    controls: [...FAMA_MACBETH_CONTROLS],
    standardization: input.spec.inference.famaMacbeth.standardization,
    periodsConsidered: input.famaMacbethAttempts.length,
    periodsEstimated: estimates.length,
    averageObservations: estimates.length
      ? estimates.reduce((sum, estimate) => sum + estimate.observations, 0) / estimates.length
      : 0,
    ...(coefficientInference
      ? { candidateCoefficient: coefficientInference }
      : {
          unavailableReason:
            adequatePeriods >= input.spec.inference.famaMacbeth.minimumPeriods &&
            input.famaMacbethAttempts.some((attempt) => attempt.collinear)
              ? ('collinear_exposure' as const)
              : ('insufficient_periods' as const),
        }),
  };

  return {
    version: 1,
    standardError: input.spec.inference.standardError,
    confidenceLevel: input.spec.inference.confidenceLevel,
    rankIc: infer(input.rankIc),
    longShort: {
      equalGross: infer(input.equalGross),
      equalNet: infer(input.equalNet),
      mktcapGross: infer(input.mktcapGross),
      mktcapNet: infer(input.mktcapNet),
    },
    famaMacbeth,
  };
}
