import type {
  FactorTimeSeriesAssetReportV1,
  FactorTimeSeriesReportV1,
  TimeSeriesFactorResearchSpecV1,
} from '@jixie/shared';
import { linearRegression, mean, pearson } from '../lib/stats.js';
import { automaticNeweyWestLag, neweyWestRegression } from '../lib/inference.js';

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
      : automaticNeweyWestLag(observations);
  return Math.min(Math.max(requestedLag, overlappingTargetLag(researchSpec)), observations - 1);
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
  return (
    neweyWestRegression(
      xs.map((value) => [1, value]),
      ys,
      requestedLag,
    )?.tStatistics[1] ?? 0
  );
}
