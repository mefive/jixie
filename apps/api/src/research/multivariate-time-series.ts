import type {
  MultivariateTimeSeriesProtocolSpecV1,
  MultivariateTimeSeriesRelationshipResultV1,
  ResearchDiagnosticV1,
  ResearchMultivariatePointV1,
  ResearchRollingCoefficientPointV1,
} from '@jixie/shared';
import {
  automaticNeweyWestLag,
  leastSquaresCoefficients,
  neweyWestRegression,
} from '../lib/inference.js';
import { mean, pearson, std } from '../lib/stats.js';
import type { ResearchSeriesPoint } from './series.js';

const NORMAL_95_PERCENT_CRITICAL_VALUE = 1.959963984540054;
const NUMERICAL_TOLERANCE = 1e-12;

export interface MultivariateTimeSeriesEvaluation {
  result: MultivariateTimeSeriesRelationshipResultV1;
  diagnostics: ResearchDiagnosticV1[];
}

export function evaluateMultivariateTimeSeriesRelationship(
  protocol: MultivariateTimeSeriesProtocolSpecV1,
  series: ReadonlyMap<string, ResearchSeriesPoint[]>,
  minimumObservations: number,
): MultivariateTimeSeriesEvaluation {
  const points = alignMultivariatePoints(protocol, series);
  if (points.length < minimumObservations) {
    throw new Error(
      `multivariate_time_series_relationship requires at least ${minimumObservations} aligned observations; received ${points.length}`,
    );
  }
  const response = points.map((point) => point.outcome);
  const predictorColumns = protocol.predictors.map((predictor) =>
    points.map((point) => point.predictors[predictor.input]!),
  );
  const design = points.map((_, row) => [1, ...predictorColumns.map((column) => column[row]!)]);
  const neweyWestLag = resolveNeweyWestLag(protocol, points.length);
  const inference = neweyWestRegression(design, response, neweyWestLag);
  if (!inference) {
    throw new Error(
      'multivariate_time_series_relationship regression is singular; remove duplicate or constant predictors',
    );
  }
  const fitted = design.map((row) => dot(row, inference.coefficients));
  const residuals = response.map((value, index) => value - fitted[index]!);
  const fullSse = sumSquares(residuals);
  const totalSse = response.reduce((sum, value) => sum + (value - mean(response)) ** 2, 0);
  const rSquared = totalSse > NUMERICAL_TOLERANCE ? 1 - fullSse / totalSse : 0;
  const predictorCount = protocol.predictors.length;
  const adjustedRSquared =
    points.length > predictorCount + 1
      ? 1 - ((1 - rSquared) * (points.length - 1)) / (points.length - predictorCount - 1)
      : rSquared;
  const responseScale = std(response);

  const coefficients = protocol.predictors.map((predictor, index) => {
    const estimate = inference.coefficients[index + 1]!;
    const standardError = inference.standardErrors[index + 1]!;
    const radius = NORMAL_95_PERCENT_CRITICAL_VALUE * standardError;
    const reducedDesign = design.map((row) => row.filter((_, column) => column !== index + 1));
    const reducedCoefficients = leastSquaresCoefficients(reducedDesign, response);
    if (!reducedCoefficients) {
      throw new Error(`unable to estimate reduced model for predictor ${predictor.input}`);
    }
    const reducedResiduals = response.map(
      (value, row) => value - dot(reducedDesign[row]!, reducedCoefficients),
    );
    const reducedSse = sumSquares(reducedResiduals);
    const standardizationScale =
      responseScale > NUMERICAL_TOLERANCE ? std(predictorColumns[index]!) / responseScale : 0;
    return {
      inputId: predictor.input,
      role: predictor.role,
      lag: predictor.lag,
      estimate,
      standardError,
      tStatistic: inference.tStatistics[index + 1]!,
      confidenceInterval95: { lower: estimate - radius, upper: estimate + radius },
      standardizedEstimate: estimate * standardizationScale,
      standardizedConfidenceInterval95: {
        lower: (estimate - radius) * standardizationScale,
        upper: (estimate + radius) * standardizationScale,
      },
      partialRSquared:
        reducedSse > NUMERICAL_TOLERANCE
          ? Math.max(0, Math.min(1, (reducedSse - fullSse) / reducedSse))
          : 0,
      varianceInflationFactor: varianceInflationFactor(predictorColumns, index),
    };
  });

  const predictorCorrelations = protocol.predictors.flatMap((left, leftIndex) =>
    protocol.predictors.map((right, rightIndex) => ({
      leftInputId: left.input,
      rightInputId: right.input,
      value: pearson(predictorColumns[leftIndex]!, predictorColumns[rightIndex]!),
    })),
  );
  const focalIndex = protocol.predictors.findIndex((predictor) => predictor.role === 'focal');
  const controlIndexes = protocol.predictors
    .map((_, index) => index)
    .filter((index) => index !== focalIndex);
  const controlDesign = points.map((_, row) => [
    1,
    ...controlIndexes.map((index) => predictorColumns[index]![row]!),
  ]);
  const focalResiduals = residualize(predictorColumns[focalIndex]!, controlDesign);
  const outcomeResiduals = residualize(response, controlDesign);
  const partialRegression = points.map((point, index) => ({
    date: point.date,
    focalResidual: focalResiduals[index]!,
    outcomeResidual: outcomeResiduals[index]!,
  }));
  const rolling = protocol.rollingWindow
    ? rollingFocalCoefficient(protocol, points, focalIndex, protocol.rollingWindow)
    : [];
  const residualLag1Autocorrelation =
    residuals.length > 2 ? pearson(residuals.slice(1), residuals.slice(0, -1)) : null;
  const diagnostics = multivariateDiagnostics(
    points.length,
    coefficients,
    predictorCorrelations,
    residualLag1Autocorrelation,
    protocol.rollingWindow,
    rolling.length,
  );

  return {
    result: {
      kind: 'multivariate_time_series_relationship',
      version: 1,
      observations: points.length,
      intercept: inference.coefficients[0]!,
      rSquared,
      adjustedRSquared,
      neweyWestLag,
      residualLag1Autocorrelation,
      coefficients,
      predictorCorrelations,
      points,
      partialRegression,
      rolling,
    },
    diagnostics,
  };
}

export function alignMultivariatePoints(
  protocol: MultivariateTimeSeriesProtocolSpecV1,
  series: ReadonlyMap<string, ResearchSeriesPoint[]>,
): ResearchMultivariatePointV1[] {
  const requiredIds = [
    protocol.outcome,
    ...protocol.predictors.map((predictor) => predictor.input),
  ];
  const byInput = new Map(
    requiredIds.map((inputId) => [
      inputId,
      new Map((series.get(inputId) ?? []).map((point) => [point.date, point.value])),
    ]),
  );
  const firstDates = [...(byInput.get(requiredIds[0]!)?.keys() ?? [])];
  const sharedDates = firstDates
    .filter((date) => requiredIds.every((inputId) => byInput.get(inputId)!.has(date)))
    .sort((left, right) => left.localeCompare(right));
  const maximumLag = Math.max(...protocol.predictors.map((predictor) => predictor.lag));
  const points: ResearchMultivariatePointV1[] = [];
  for (let index = maximumLag; index < sharedDates.length; index++) {
    const date = sharedDates[index]!;
    const predictors = Object.fromEntries(
      protocol.predictors.map((predictor) => [
        predictor.input,
        byInput.get(predictor.input)!.get(sharedDates[index - predictor.lag]!)!,
      ]),
    );
    points.push({ date, outcome: byInput.get(protocol.outcome)!.get(date)!, predictors });
  }
  return points;
}

function rollingFocalCoefficient(
  protocol: MultivariateTimeSeriesProtocolSpecV1,
  points: ResearchMultivariatePointV1[],
  focalIndex: number,
  window: number,
): ResearchRollingCoefficientPointV1[] {
  if (window > points.length || window <= protocol.predictors.length + 2) {
    return [];
  }
  const rolling: ResearchRollingCoefficientPointV1[] = [];
  for (let end = window; end <= points.length; end++) {
    const sample = points.slice(end - window, end);
    const response = sample.map((point) => point.outcome);
    const design = sample.map((point) => [
      1,
      ...protocol.predictors.map((predictor) => point.predictors[predictor.input]!),
    ]);
    const lag = resolveNeweyWestLag(protocol, sample.length);
    const inference = neweyWestRegression(design, response, lag);
    if (!inference) {
      continue;
    }
    const estimate = inference.coefficients[focalIndex + 1]!;
    const radius = NORMAL_95_PERCENT_CRITICAL_VALUE * inference.standardErrors[focalIndex + 1]!;
    const residuals = response.map(
      (value, index) => value - dot(design[index]!, inference.coefficients),
    );
    const total = response.reduce((sum, value) => sum + (value - mean(response)) ** 2, 0);
    rolling.push({
      date: sample.at(-1)!.date,
      observations: sample.length,
      estimate,
      confidenceInterval95: { lower: estimate - radius, upper: estimate + radius },
      rSquared: total > NUMERICAL_TOLERANCE ? 1 - sumSquares(residuals) / total : 0,
    });
  }
  return rolling;
}

function resolveNeweyWestLag(
  protocol: MultivariateTimeSeriesProtocolSpecV1,
  observations: number,
): number {
  return protocol.inference.lag === 'automatic'
    ? automaticNeweyWestLag(observations)
    : Math.min(protocol.inference.lag, observations - 1);
}

function varianceInflationFactor(columns: number[][], targetIndex: number): number {
  const target = columns[targetIndex]!;
  const otherIndexes = columns.map((_, index) => index).filter((index) => index !== targetIndex);
  const design = target.map((_, row) => [1, ...otherIndexes.map((index) => columns[index]![row]!)]);
  const coefficients = leastSquaresCoefficients(design, target);
  if (!coefficients) {
    return 1_000_000_000_000;
  }
  const residuals = target.map((value, row) => value - dot(design[row]!, coefficients));
  const total = target.reduce((sum, value) => sum + (value - mean(target)) ** 2, 0);
  if (total <= NUMERICAL_TOLERANCE) {
    return 1_000_000_000_000;
  }
  const rSquared = Math.max(0, Math.min(1, 1 - sumSquares(residuals) / total));
  return 1 / Math.max(NUMERICAL_TOLERANCE, 1 - rSquared);
}

function residualize(values: number[], design: number[][]): number[] {
  const coefficients = leastSquaresCoefficients(design, values);
  if (!coefficients) {
    throw new Error('partial regression control matrix is singular');
  }
  return values.map((value, index) => value - dot(design[index]!, coefficients));
}

function multivariateDiagnostics(
  observations: number,
  coefficients: MultivariateTimeSeriesRelationshipResultV1['coefficients'],
  correlations: MultivariateTimeSeriesRelationshipResultV1['predictorCorrelations'],
  residualLag1: number | null,
  rollingWindow: number | undefined,
  rollingWindows: number,
): ResearchDiagnosticV1[] {
  const diagnostics: ResearchDiagnosticV1[] = [];
  const suggestedObservations = 10 * (coefficients.length + 1);
  if (observations < suggestedObservations) {
    diagnostics.push({
      code: 'multivariate_sample_thin_for_dimensions',
      severity: 'warning',
      messageZh: `当前 ${observations} 个观测相对 ${coefficients.length} 个解释变量偏少；经验诊断建议至少 ${suggestedObservations} 个观测。`,
      messageEn: `${observations} observations are thin for ${coefficients.length} predictors; the heuristic diagnostic recommends at least ${suggestedObservations}.`,
    });
  }
  const highVif = coefficients.filter((coefficient) => coefficient.varianceInflationFactor >= 5);
  if (highVif.length > 0) {
    diagnostics.push({
      code: 'multivariate_high_vif',
      severity: 'warning',
      messageZh: `以下变量的 VIF 不低于 5，偏回归系数可能对样本敏感：${highVif.map((item) => `${item.inputId} (${item.varianceInflationFactor.toFixed(1)})`).join('、')}。`,
      messageEn: `The following predictors have VIF at or above 5, so partial coefficients may be sample-sensitive: ${highVif.map((item) => `${item.inputId} (${item.varianceInflationFactor.toFixed(1)})`).join(', ')}.`,
    });
  }
  const highPairs = correlations.filter(
    (item) => item.leftInputId < item.rightInputId && Math.abs(item.value) >= 0.8,
  );
  if (highPairs.length > 0) {
    diagnostics.push({
      code: 'multivariate_high_pairwise_correlation',
      severity: 'warning',
      messageZh: `解释变量存在绝对相关系数不低于 0.8 的组合：${highPairs.map((item) => `${item.leftInputId}/${item.rightInputId} (${item.value.toFixed(2)})`).join('、')}。`,
      messageEn: `Predictor pairs with absolute correlation at or above 0.8: ${highPairs.map((item) => `${item.leftInputId}/${item.rightInputId} (${item.value.toFixed(2)})`).join(', ')}.`,
    });
  }
  if (residualLag1 != null && Math.abs(residualLag1) >= 0.3) {
    diagnostics.push({
      code: 'multivariate_residual_autocorrelation',
      severity: 'warning',
      messageZh: `残差一阶自相关为 ${residualLag1.toFixed(2)}；HAC 区间已做稳健调整，但模型动态结构可能仍不完整。`,
      messageEn: `Residual lag-1 autocorrelation is ${residualLag1.toFixed(2)}; HAC adjusts inference, but the model's dynamic structure may remain incomplete.`,
    });
  }
  if (rollingWindow != null && rollingWindows === 0) {
    diagnostics.push({
      code: 'multivariate_rolling_unavailable',
      severity: 'warning',
      messageZh: `滚动窗口 ${rollingWindow} 无法在当前样本上估计。`,
      messageEn: `Rolling window ${rollingWindow} cannot be estimated on the current sample.`,
    });
  }
  diagnostics.push({
    code: 'multivariate_association_not_causation',
    severity: 'info',
    messageZh: '多变量回归减少了已纳入控制变量的混杂，但仍不能把偏回归系数解释为因果效应。',
    messageEn:
      'Multivariate regression reduces confounding from included controls but does not make the partial coefficient causal.',
  });
  return diagnostics;
}

function sumSquares(values: number[]): number {
  return values.reduce((sum, value) => sum + value * value, 0);
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}
