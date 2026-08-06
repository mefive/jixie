import type {
  FactorTimeSeriesAssetReportV1,
  FactorTimeSeriesReportV1,
  TimeSeriesFactorResearchSpecV1,
} from '@jixie/shared';
import { linearRegression, mean, pearson } from '../lib/stats.js';

export interface TimeSeriesEvaluationObservation {
  assetId: string;
  asOfDate: string;
  featureAvailableDate: string;
  targetDate: string;
  score: number;
  forwardReturn: number;
}

const MIN_OBSERVATIONS = 3;

export class TimeSeriesEvaluator {
  public readonly analysisKind = 'time_series' as const;

  public evaluate(
    researchSpec: TimeSeriesFactorResearchSpecV1,
    observations: TimeSeriesEvaluationObservation[],
  ): FactorTimeSeriesReportV1 {
    const validated = validateObservations(researchSpec, observations);
    const byAsset = researchSpec.assets.map((assetId) => {
      const assetObservations = validated.filter((observation) => observation.assetId === assetId);
      return summarizeAsset(
        assetId,
        assetObservations,
        resolveNeweyWestLag(researchSpec, assetObservations.length),
      );
    });

    return {
      assets: researchSpec.assets.slice(),
      periods: new Set(validated.map((observation) => observation.asOfDate)).size,
      observations: validated.length,
      byAsset,
    };
  }
}

export function resolveNeweyWestLag(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  observations: number,
): number {
  const requestedLag =
    typeof researchSpec.inference.lag === 'number'
      ? researchSpec.inference.lag
      : Math.floor(4 * (Math.max(observations, 1) / 100) ** (2 / 9));
  return Math.min(
    Math.max(requestedLag, overlappingTargetLag(researchSpec)),
    Math.max(0, observations - 1),
  );
}

function overlappingTargetLag(researchSpec: TimeSeriesFactorResearchSpecV1): number {
  const observationsPerUnit = {
    daily: { trade_day: 1, calendar_day: 1, month: 21 },
    weekly: { trade_day: 1 / 5, calendar_day: 1 / 7, month: 4 },
    monthly: { trade_day: 1 / 21, calendar_day: 1 / 30, month: 1 },
  }[researchSpec.observationFrequency][researchSpec.target.horizonUnit];
  return Math.max(0, Math.ceil(researchSpec.target.horizon * observationsPerUnit) - 1);
}

function validateObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  observations: TimeSeriesEvaluationObservation[],
): TimeSeriesEvaluationObservation[] {
  const allowedAssets = new Set(researchSpec.assets);
  const seen = new Set<string>();
  const validated = observations
    .map((observation) => ({ ...observation }))
    .sort((left, right) =>
      left.assetId === right.assetId
        ? left.asOfDate.localeCompare(right.asOfDate)
        : left.assetId.localeCompare(right.assetId),
    );

  for (const observation of validated) {
    if (!allowedAssets.has(observation.assetId)) {
      throw new Error(`Time-series observation uses undeclared asset ${observation.assetId}.`);
    }
    if (!Number.isFinite(observation.score) || !Number.isFinite(observation.forwardReturn)) {
      throw new Error('Time-series observations require finite scores and forward returns.');
    }
    if (
      !/^\d{8}$/.test(observation.asOfDate) ||
      !/^\d{8}$/.test(observation.featureAvailableDate) ||
      !/^\d{8}$/.test(observation.targetDate)
    ) {
      throw new Error('Time-series observation dates must use YYYYMMDD.');
    }
    if (observation.asOfDate < researchSpec.start || observation.asOfDate > researchSpec.end) {
      throw new Error(`Observation ${observation.asOfDate} is outside the frozen research window.`);
    }
    if (observation.featureAvailableDate > observation.asOfDate) {
      throw new Error('Feature availability after as-of date would introduce look-ahead bias.');
    }
    if (observation.targetDate <= observation.asOfDate) {
      throw new Error('Forward-return target must end after the factor as-of date.');
    }
    if (
      researchSpec.dataPolicy.dataCutoff &&
      observation.targetDate > researchSpec.dataPolicy.dataCutoff
    ) {
      throw new Error('Forward-return target extends beyond the frozen data cutoff.');
    }
    const key = `${observation.assetId}:${observation.asOfDate}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate time-series observation ${key}.`);
    }
    seen.add(key);
  }

  for (const assetId of researchSpec.assets) {
    const count = validated.filter((observation) => observation.assetId === assetId).length;
    if (count < MIN_OBSERVATIONS) {
      throw new Error(
        `Time-series asset ${assetId} requires at least ${MIN_OBSERVATIONS} observations.`,
      );
    }
  }
  return validated;
}

function summarizeAsset(
  assetId: string,
  observations: TimeSeriesEvaluationObservation[],
  requestedLag: number,
): FactorTimeSeriesAssetReportV1 {
  const scores = observations.map((observation) => observation.score);
  const returns = observations.map((observation) => observation.forwardReturn);
  const { slope } = linearRegression(scores, returns);
  const positiveReturns = observations
    .filter((observation) => observation.score > 0)
    .map((observation) => observation.forwardReturn);
  const negativeReturns = observations
    .filter((observation) => observation.score < 0)
    .map((observation) => observation.forwardReturn);
  const directional = observations.filter((observation) => observation.score !== 0);

  return {
    assetId,
    observations: observations.length,
    correlation: pearson(scores, returns),
    regressionSlope: slope,
    directionHitRate:
      directional.length === 0
        ? 0
        : directional.filter(
            (observation) => Math.sign(observation.score) === Math.sign(observation.forwardReturn),
          ).length / directional.length,
    neweyWestLag: requestedLag,
    neweyWestTStat: neweyWestSlopeTStat(scores, returns, requestedLag),
    positiveStateMeanReturn: positiveReturns.length ? mean(positiveReturns) : null,
    negativeStateMeanReturn: negativeReturns.length ? mean(negativeReturns) : null,
  };
}

function neweyWestSlopeTStat(xs: number[], ys: number[], requestedLag: number): number {
  const { slope, intercept } = linearRegression(xs, ys);
  const n = xs.length;
  const lag = Math.min(requestedLag, n - 1);
  const sumX = xs.reduce((sum, value) => sum + value, 0);
  const sumXX = xs.reduce((sum, value) => sum + value * value, 0);
  const determinant = n * sumXX - sumX * sumX;
  if (determinant <= 0) {
    return 0;
  }
  const inverse = [sumXX / determinant, -sumX / determinant, n / determinant] as const;
  const residuals = ys.map((value, index) => value - intercept - slope * xs[index]);
  let meat00 = 0;
  let meat01 = 0;
  let meat11 = 0;

  for (let t = 0; t < n; t++) {
    const squared = residuals[t] * residuals[t];
    meat00 += squared;
    meat01 += squared * xs[t];
    meat11 += squared * xs[t] * xs[t];
  }
  for (let distance = 1; distance <= lag; distance++) {
    const weight = 1 - distance / (lag + 1);
    for (let t = distance; t < n; t++) {
      const product = weight * residuals[t] * residuals[t - distance];
      meat00 += 2 * product;
      meat01 += product * (xs[t] + xs[t - distance]);
      meat11 += 2 * product * xs[t] * xs[t - distance];
    }
  }

  const [, b, d] = inverse;
  const slopeVariance = b * b * meat00 + 2 * b * d * meat01 + d * d * meat11;
  const standardError = Math.sqrt(Math.max(0, slopeVariance));
  return standardError > 0 ? slope / standardError : 0;
}
