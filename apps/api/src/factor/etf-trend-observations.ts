import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { addDays } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import type { CompiledTimeSeriesFactor } from './compile-time-series-factor.js';
import { factorV2YieldTerm, type FactorV2FieldKey } from './factor-v2-fields.js';
import type { TimeSeriesEvaluationObservation } from './time-series-evaluator.js';
import {
  CHINA_TREASURY_CURVE_CODE,
  CHINA_TREASURY_CURVE_SOURCE,
  CHINA_TREASURY_CURVE_TYPE,
} from '../rates/china-treasury-curve.js';

export interface EtfTrendDailyRow {
  assetId: string;
  tradeDate: string;
  close: number;
  adjustmentFactor: number;
}

export interface YieldCurveObservationRow {
  tradeDate: string;
  availableDate: string;
  termYears: number;
  yieldPct: number;
}

export async function loadEtfTimeSeriesObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  factor: CompiledTimeSeriesFactor,
): Promise<TimeSeriesEvaluationObservation[]> {
  assertSupportedProtocol(researchSpec, factor);
  const historyStart = addDays(
    researchSpec.start,
    -(factor.window - 1 + researchSpec.target.horizon) * 3,
  );
  const upperBound = researchSpec.dataPolicy.dataCutoff ?? undefined;
  const yieldTerms = factor.inputs
    .map(factorV2YieldTerm)
    .filter((term): term is number => term !== null);
  const [bars, adjustments, curvePoints, assets] = await Promise.all([
    prisma.etfDaily.findMany({
      where: {
        tsCode: { in: researchSpec.assets },
        tradeDate: { gte: historyStart, ...(upperBound ? { lte: upperBound } : {}) },
        close: { not: null },
      },
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    prisma.etfAdjFactor.findMany({
      where: {
        tsCode: { in: researchSpec.assets },
        tradeDate: { gte: historyStart, ...(upperBound ? { lte: upperBound } : {}) },
      },
      select: { tsCode: true, tradeDate: true, adjFactor: true },
    }),
    yieldTerms.length === 0
      ? Promise.resolve([])
      : prisma.yieldCurvePoint.findMany({
          where: {
            source: CHINA_TREASURY_CURVE_SOURCE,
            curveCode: CHINA_TREASURY_CURVE_CODE,
            curveType: CHINA_TREASURY_CURVE_TYPE,
            termYears: { in: yieldTerms },
            availableDate: {
              gte: addDays(historyStart, -14),
              ...(upperBound ? { lte: upperBound } : {}),
            },
          },
          select: {
            tradeDate: true,
            availableDate: true,
            termYears: true,
            yieldPct: true,
          },
          orderBy: [{ termYears: 'asc' }, { availableDate: 'asc' }],
        }),
    yieldTerms.length === 0
      ? Promise.resolve([])
      : prisma.etfBasic.findMany({
          where: { tsCode: { in: researchSpec.assets } },
          select: { tsCode: true, fundType: true },
        }),
  ]);
  if (
    yieldTerms.length > 0 &&
    (assets.length !== researchSpec.assets.length ||
      assets.some((asset) => asset.fundType !== '债券型'))
  ) {
    throw new Error('China government-curve factors currently require fixed-income ETF targets.');
  }
  const adjustmentByAssetDate = new Map(
    adjustments.map((row) => [`${row.tsCode}:${row.tradeDate}`, row.adjFactor]),
  );
  return buildEtfTimeSeriesObservations(
    researchSpec,
    bars.map((bar) => ({
      assetId: bar.tsCode,
      tradeDate: bar.tradeDate,
      close: bar.close!,
      adjustmentFactor: adjustmentByAssetDate.get(`${bar.tsCode}:${bar.tradeDate}`) ?? Number.NaN,
    })),
    factor,
    curvePoints,
  );
}

export async function buildEtfTimeSeriesObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  rows: EtfTrendDailyRow[],
  factor: CompiledTimeSeriesFactor,
  curveRows: YieldCurveObservationRow[] = [],
): Promise<TimeSeriesEvaluationObservation[]> {
  assertSupportedProtocol(researchSpec, factor);
  const declaredAssets = new Set(researchSpec.assets);
  const byAsset = new Map<string, EtfTrendDailyRow[]>();

  for (const row of rows) {
    if (!declaredAssets.has(row.assetId)) {
      throw new Error(`ETF trend data uses undeclared asset ${row.assetId}.`);
    }
    if (
      !/^\d{8}$/.test(row.tradeDate) ||
      !Number.isFinite(row.close) ||
      row.close <= 0 ||
      !Number.isFinite(row.adjustmentFactor) ||
      row.adjustmentFactor <= 0
    ) {
      throw new Error(`ETF trend data is incomplete for ${row.assetId} on ${row.tradeDate}.`);
    }
    const assetRows = byAsset.get(row.assetId) ?? [];
    assetRows.push({ ...row });
    byAsset.set(row.assetId, assetRows);
  }

  const observations: TimeSeriesEvaluationObservation[] = [];
  for (const assetId of researchSpec.assets) {
    const assetRows = (byAsset.get(assetId) ?? []).sort((left, right) =>
      left.tradeDate.localeCompare(right.tradeDate),
    );
    const seenDates = new Set<string>();
    for (const row of assetRows) {
      if (seenDates.has(row.tradeDate)) {
        throw new Error(`Duplicate ETF trend bar ${assetId}:${row.tradeDate}.`);
      }
      seenDates.add(row.tradeDate);
    }
    const adjustedCloses = assetRows.map((row) => row.close * row.adjustmentFactor);
    const { fields, availableDates } = alignedFactorFields(
      assetRows,
      adjustedCloses,
      factor.inputs,
      curveRows,
    );
    const indexes: number[] = [];
    for (
      let index = factor.window - 1;
      index + researchSpec.target.horizon < assetRows.length;
      index++
    ) {
      const current = assetRows[index];
      const target = assetRows[index + researchSpec.target.horizon];
      if (current.tradeDate < researchSpec.start || current.tradeDate > researchSpec.end) {
        continue;
      }
      if (
        researchSpec.dataPolicy.dataCutoff &&
        target.tradeDate > researchSpec.dataPolicy.dataCutoff
      ) {
        continue;
      }
      indexes.push(index);
    }
    const scores = await factor.computeSeries(fields, indexes);
    if (scores.length !== indexes.length) {
      throw new Error(
        `Time-series factor returned ${scores.length} scores for ${indexes.length} observations`,
      );
    }
    for (let position = 0; position < indexes.length; position++) {
      const score = scores[position];
      if (score == null) {
        continue;
      }
      const index = indexes[position];
      const current = assetRows[index];
      const target = assetRows[index + researchSpec.target.horizon];
      observations.push({
        assetId,
        asOfDate: current.tradeDate,
        featureAvailableDate: latestFeatureAvailableDate(factor.inputs, availableDates, index),
        targetDate: target.tradeDate,
        score,
        forwardReturn:
          adjustedCloses[index + researchSpec.target.horizon] / adjustedCloses[index] - 1,
      });
    }
  }
  return observations;
}

function assertSupportedProtocol(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  factor: CompiledTimeSeriesFactor,
): void {
  if (
    researchSpec.observationFrequency !== 'daily' ||
    researchSpec.target.horizonUnit !== 'trade_day'
  ) {
    throw new Error('ETF trend observations currently require daily trade-day horizons.');
  }
  if (
    factor.analysisKind !== 'time_series' ||
    factor.outputScope !== 'asset' ||
    factor.frequency !== 'daily' ||
    factor.inputs.length === 0
  ) {
    throw new Error('ETF observations require a daily asset-scope Factor V2 definition.');
  }
}

function alignedFactorFields(
  assetRows: EtfTrendDailyRow[],
  adjustedCloses: number[],
  inputs: FactorV2FieldKey[],
  curveRows: YieldCurveObservationRow[],
): {
  fields: Partial<Record<FactorV2FieldKey, number[]>>;
  availableDates: Partial<Record<FactorV2FieldKey, string[]>>;
} {
  const fields: Partial<Record<FactorV2FieldKey, number[]>> = {};
  const availableDates: Partial<Record<FactorV2FieldKey, string[]>> = {};
  if (inputs.includes('etf.adjustedClose')) {
    fields['etf.adjustedClose'] = adjustedCloses;
    availableDates['etf.adjustedClose'] = assetRows.map((row) => row.tradeDate);
  }
  for (const input of inputs) {
    const termYears = factorV2YieldTerm(input);
    if (termYears === null) {
      continue;
    }
    const termRows = curveRows
      .filter((row) => row.termYears === termYears)
      .sort((left, right) => left.availableDate.localeCompare(right.availableDate));
    if (termRows.length === 0) {
      throw new Error(`No point-in-time government curve data is available for ${termYears}Y.`);
    }
    const values: number[] = [];
    const dates: string[] = [];
    let position = 0;
    let latest: YieldCurveObservationRow | null = null;
    for (const assetRow of assetRows) {
      while (position < termRows.length && termRows[position].availableDate <= assetRow.tradeDate) {
        latest = termRows[position];
        position++;
      }
      values.push(latest?.yieldPct ?? Number.NaN);
      dates.push(latest?.availableDate ?? '');
    }
    fields[input] = values;
    availableDates[input] = dates;
  }
  return { fields, availableDates };
}

function latestFeatureAvailableDate(
  inputs: FactorV2FieldKey[],
  availableDates: Partial<Record<FactorV2FieldKey, string[]>>,
  index: number,
): string {
  const dates = inputs
    .map((input) => availableDates[input]?.[index])
    .filter((date): date is string => Boolean(date))
    .sort();
  if (dates.length !== inputs.length) {
    throw new Error('Factor produced a score with an unavailable point-in-time input.');
  }
  return dates.at(-1)!;
}
