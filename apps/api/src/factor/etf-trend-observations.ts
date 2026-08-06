import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { addDays } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import type { TimeSeriesEvaluationObservation } from './time-series-evaluator.js';

export interface EtfTrendDailyRow {
  assetId: string;
  tradeDate: string;
  close: number;
  adjustmentFactor: number;
}

export async function loadEtfTrendObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  lookback: number,
): Promise<TimeSeriesEvaluationObservation[]> {
  assertSupportedProtocol(researchSpec, lookback);
  const historyStart = addDays(researchSpec.start, -(lookback + researchSpec.target.horizon) * 3);
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
  return buildEtfTrendObservations(
    researchSpec,
    bars.map((bar) => ({
      assetId: bar.tsCode,
      tradeDate: bar.tradeDate,
      close: bar.close!,
      adjustmentFactor: adjustmentByAssetDate.get(`${bar.tsCode}:${bar.tradeDate}`) ?? Number.NaN,
    })),
    lookback,
  );
}

export function buildEtfTrendObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  rows: EtfTrendDailyRow[],
  lookback: number,
): TimeSeriesEvaluationObservation[] {
  assertSupportedProtocol(researchSpec, lookback);
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
    for (let index = lookback; index + researchSpec.target.horizon < assetRows.length; index++) {
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
      observations.push({
        assetId,
        asOfDate: current.tradeDate,
        featureAvailableDate: current.tradeDate,
        targetDate: target.tradeDate,
        score: adjustedCloses[index] / adjustedCloses[index - lookback] - 1,
        forwardReturn:
          adjustedCloses[index + researchSpec.target.horizon] / adjustedCloses[index] - 1,
      });
    }
  }
  return observations;
}

function assertSupportedProtocol(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  lookback: number,
): void {
  if (
    researchSpec.observationFrequency !== 'daily' ||
    researchSpec.target.horizonUnit !== 'trade_day'
  ) {
    throw new Error('ETF trend observations currently require daily trade-day horizons.');
  }
  if (!Number.isInteger(lookback) || lookback < 2 || lookback > 504) {
    throw new Error('ETF trend lookback must be an integer between 2 and 504 trading days.');
  }
}
