import type {
  ResearchDiagnosticV1,
  ResearchRelationshipPointV1,
  ResearchRollingRelationshipPointV1,
  TimeSeriesRelationshipProtocolSpecV1,
  TimeSeriesRelationshipResultV1,
} from '@jixie/shared';
import { automaticNeweyWestLag, neweyWestRegression } from '../lib/inference.js';
import { linearRegression, pearson, spearman } from '../lib/stats.js';
import type { ResearchSeriesPoint } from './series.js';

const NORMAL_95_PERCENT_CRITICAL_VALUE = 1.959963984540054;

export interface TimeSeriesRelationshipEvaluation {
  result: TimeSeriesRelationshipResultV1;
  diagnostics: ResearchDiagnosticV1[];
}

export function evaluateTimeSeriesRelationship(
  protocol: TimeSeriesRelationshipProtocolSpecV1,
  predictor: ResearchSeriesPoint[],
  outcome: ResearchSeriesPoint[],
  minimumObservations: number,
): TimeSeriesRelationshipEvaluation {
  const points = alignRelationshipPoints(predictor, outcome, protocol.predictorLag);
  if (points.length < minimumObservations) {
    throw new Error(
      `time_series_relationship requires at least ${minimumObservations} aligned observations; received ${points.length}`,
    );
  }
  const xs = points.map((point) => point.predictor);
  const ys = points.map((point) => point.outcome);
  const ordinary = linearRegression(xs, ys);
  const neweyWestLag =
    protocol.inference.lag === 'automatic'
      ? automaticNeweyWestLag(points.length)
      : Math.min(protocol.inference.lag, points.length - 1);
  const inference = neweyWestRegression(
    xs.map((value) => [1, value]),
    ys,
    neweyWestLag,
  );
  if (!inference) {
    throw new Error('time_series_relationship regression is singular');
  }
  const slopeStandardError = inference.standardErrors[1]!;
  const slope = inference.coefficients[1]!;
  const radius = NORMAL_95_PERCENT_CRITICAL_VALUE * slopeStandardError;
  const requestedPearson = protocol.correlations.includes('pearson');
  const requestedSpearman = protocol.correlations.includes('spearman');
  const rolling = protocol.rollingWindow
    ? rollingRelationship(points, protocol.rollingWindow, requestedPearson, requestedSpearman)
    : [];
  const residuals = points.map(
    (point) => point.outcome - (ordinary.intercept + ordinary.slope * point.predictor),
  );
  const diagnostics = relationshipDiagnostics(protocol, xs, ys, residuals, rolling);

  return {
    result: {
      kind: 'time_series_relationship',
      version: 1,
      observations: points.length,
      pearson: requestedPearson ? pearson(xs, ys) : null,
      spearman: requestedSpearman ? spearman(xs, ys) : null,
      regression: {
        intercept: inference.coefficients[0]!,
        slope,
        rSquared: ordinary.r2,
        slopeStandardError,
        slopeTStatistic: inference.tStatistics[1]!,
        slopeConfidenceInterval95: { lower: slope - radius, upper: slope + radius },
        neweyWestLag,
      },
      points,
      rolling,
    },
    diagnostics,
  };
}

export function alignRelationshipPoints(
  predictor: ResearchSeriesPoint[],
  outcome: ResearchSeriesPoint[],
  predictorLag: number,
): ResearchRelationshipPointV1[] {
  const predictorByDate = new Map(predictor.map((point) => [point.date, point.value]));
  const outcomeByDate = new Map(outcome.map((point) => [point.date, point.value]));
  const sharedDates = [...predictorByDate.keys()]
    .filter((date) => outcomeByDate.has(date))
    .sort((left, right) => left.localeCompare(right));
  const points: ResearchRelationshipPointV1[] = [];
  for (let index = predictorLag; index < sharedDates.length; index++) {
    const predictorDate = sharedDates[index - predictorLag]!;
    const outcomeDate = sharedDates[index]!;
    const predictorValue = predictorByDate.get(predictorDate);
    const outcomeValue = outcomeByDate.get(outcomeDate);
    if (predictorValue == null || outcomeValue == null) {
      continue;
    }
    points.push({ date: outcomeDate, predictor: predictorValue, outcome: outcomeValue });
  }
  return points;
}

function rollingRelationship(
  points: ResearchRelationshipPointV1[],
  window: number,
  includePearson: boolean,
  includeSpearman: boolean,
): ResearchRollingRelationshipPointV1[] {
  if (window > points.length) {
    return [];
  }
  const rows: ResearchRollingRelationshipPointV1[] = [];
  for (let index = window - 1; index < points.length; index++) {
    const sample = points.slice(index - window + 1, index + 1);
    const xs = sample.map((point) => point.predictor);
    const ys = sample.map((point) => point.outcome);
    rows.push({
      date: points[index]!.date,
      observations: sample.length,
      pearson: includePearson ? pearson(xs, ys) : null,
      spearman: includeSpearman ? spearman(xs, ys) : null,
      slope: linearRegression(xs, ys).slope,
    });
  }
  return rows;
}

function relationshipDiagnostics(
  protocol: TimeSeriesRelationshipProtocolSpecV1,
  xs: number[],
  ys: number[],
  residuals: number[],
  rolling: ResearchRollingRelationshipPointV1[],
): ResearchDiagnosticV1[] {
  const diagnostics: ResearchDiagnosticV1[] = [];
  if (protocol.rollingWindow && rolling.length === 0) {
    diagnostics.push({
      code: 'rolling_window_exceeds_sample',
      severity: 'warning',
      messageZh: `滚动窗口 ${protocol.rollingWindow} 大于有效样本，未生成滚动结果。`,
      messageEn: `Rolling window ${protocol.rollingWindow} exceeds the valid sample; no rolling result was produced.`,
    });
  }
  if (xs.length >= 3 && residuals.length >= 3) {
    const residualAutocorrelation = pearson(residuals.slice(1), residuals.slice(0, -1));
    if (Math.abs(residualAutocorrelation) >= 0.3) {
      diagnostics.push({
        code: 'material_residual_autocorrelation',
        severity: 'warning',
        messageZh: `回归残差一阶相关为 ${residualAutocorrelation.toFixed(2)}；已使用 HAC 推断，但关系可能存在时间结构。`,
        messageEn: `Lag-1 residual correlation is ${residualAutocorrelation.toFixed(2)}; HAC inference is used, but the relationship may contain time structure.`,
      });
    }
  }
  if (seriesHasNoVariation(xs) || seriesHasNoVariation(ys)) {
    diagnostics.push({
      code: 'low_series_variation',
      severity: 'error',
      messageZh: '至少一个序列缺少有效波动，相关和回归结果不可解释。',
      messageEn:
        'At least one series lacks usable variation; correlation and regression are not interpretable.',
    });
  }
  return diagnostics;
}

function seriesHasNoVariation(values: number[]): boolean {
  return values.every((value) => value === values[0]);
}
