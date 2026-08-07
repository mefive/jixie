import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { addDays } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import type { CompiledTimeSeriesFactor } from './compile-time-series-factor.js';
import type { TimeSeriesEvaluationObservation } from './time-series-evaluator.js';

export interface EtfTrendDailyRow {
  assetId: string;
  tradeDate: string;
  close: number;
  adjustmentFactor: number;
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
  const [bars, adjustments] = await Promise.all([
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
  ]);
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
  );
}

export async function buildEtfTimeSeriesObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  rows: EtfTrendDailyRow[],
  factor: CompiledTimeSeriesFactor,
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
    const scores = await factor.computeSeries({ 'etf.adjustedClose': adjustedCloses }, indexes);
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
        featureAvailableDate: current.tradeDate,
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
    factor.inputs.length !== 1 ||
    factor.inputs[0] !== 'etf.adjustedClose'
  ) {
    throw new Error(
      'ETF observations require a daily asset-scope adjusted-close Factor V2 definition.',
    );
  }
}
