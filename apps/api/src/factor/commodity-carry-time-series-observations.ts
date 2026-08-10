import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import {
  COMMODITY_CARRY_MAX_STALENESS_DAYS,
  COMMODITY_CARRY_MINIMUM_DAYS_TO_DELIVERY,
  loadCommodityCarryHistory,
  type CommodityCarryPointV1,
} from '../commodity/commodity-carry.js';
import { COMMODITY_FUTURE_SPECS } from '../commodity/commodity-futures.js';
import { addDays, daysBetween } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import type { CompiledTimeSeriesFactor } from './compile-time-series-factor.js';
import { COMMODITY_CARRY_FIELD } from './factor-v2-fields.js';
import type { TimeSeriesEvaluationObservation } from './time-series-evaluator.js';
import type { EtfTrendDailyRow } from './etf-trend-observations.js';

interface CommodityCarryTimeSeriesMapping {
  productCode: string;
  assetId: string;
}

const COMMODITY_CARRY_TIME_SERIES_MAPPINGS: CommodityCarryTimeSeriesMapping[] =
  COMMODITY_FUTURE_SPECS.map((spec) => ({
    productCode: spec.productCode,
    assetId: spec.targetEtf,
  }));

/** Tests each product's own actual-contract carry against the forward return of its mapped ETF.
 * The future is a feature source only; all return targets remain adjusted ETF prices. */
export async function loadCommodityCarryTimeSeriesObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  factor: CompiledTimeSeriesFactor,
): Promise<TimeSeriesEvaluationObservation[]> {
  const mappings = assertCommodityCarryTimeSeriesProtocol(researchSpec, factor);
  const historyStart = addDays(
    researchSpec.start,
    -(factor.window - 1 + researchSpec.target.horizon) * 3,
  );
  const upperBound = researchSpec.dataPolicy.dataCutoff ?? undefined;
  const [bars, adjustments, carryPoints, metadata] = await Promise.all([
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
    loadCommodityCarryHistory({
      start: addDays(historyStart, -COMMODITY_CARRY_MAX_STALENESS_DAYS),
      end: researchSpec.end,
      productCodes: mappings.map((mapping) => mapping.productCode),
      minimumDaysToDelivery: COMMODITY_CARRY_MINIMUM_DAYS_TO_DELIVERY,
    }),
    prisma.etfBasic.findMany({
      where: { tsCode: { in: researchSpec.assets } },
      select: { tsCode: true },
    }),
  ]);
  if (metadata.length !== researchSpec.assets.length) {
    throw new Error('Commodity carry time-series research requires every mapped ETF.');
  }
  const adjustmentByAssetDate = new Map(
    adjustments.map((row) => [`${row.tsCode}:${row.tradeDate}`, row.adjFactor]),
  );
  return buildCommodityCarryTimeSeriesObservations(
    researchSpec,
    bars.map((bar) => ({
      assetId: bar.tsCode,
      tradeDate: bar.tradeDate,
      close: bar.close!,
      adjustmentFactor: adjustmentByAssetDate.get(`${bar.tsCode}:${bar.tradeDate}`) ?? Number.NaN,
    })),
    carryPoints,
    factor,
  );
}

export async function buildCommodityCarryTimeSeriesObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  etfRows: EtfTrendDailyRow[],
  carryPoints: CommodityCarryPointV1[],
  factor: CompiledTimeSeriesFactor,
): Promise<TimeSeriesEvaluationObservation[]> {
  const mappings = assertCommodityCarryTimeSeriesProtocol(researchSpec, factor);
  const rowsByAsset = groupAndValidateEtfRows(etfRows, mappings);
  const carryByProduct = groupAndValidateCarryPoints(carryPoints, mappings);
  const observations: TimeSeriesEvaluationObservation[] = [];

  for (const mapping of mappings) {
    const rows = (rowsByAsset.get(mapping.assetId) ?? []).sort((left, right) =>
      left.tradeDate.localeCompare(right.tradeDate),
    );
    const adjustedCloses = rows.map((row) => row.close * row.adjustmentFactor);
    const productCarry = (carryByProduct.get(mapping.productCode) ?? []).sort((left, right) =>
      left.availableDate.localeCompare(right.availableDate),
    );
    const aligned = alignCarryToEtfDates(rows, productCarry);
    const indexes: number[] = [];
    for (
      let index = factor.window - 1;
      index + researchSpec.target.horizon < rows.length;
      index++
    ) {
      const current = rows[index];
      const target = rows[index + researchSpec.target.horizon];
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
    const scores = await factor.computeSeries({ [COMMODITY_CARRY_FIELD]: aligned.values }, indexes);
    if (scores.length !== indexes.length) {
      throw new Error('Commodity carry time-series factor returned an unexpected score count.');
    }
    for (let position = 0; position < indexes.length; position++) {
      const score = scores[position];
      const index = indexes[position];
      const featureAvailableDate = aligned.availableDates[index];
      if (score == null || !featureAvailableDate) {
        continue;
      }
      const targetIndex = index + researchSpec.target.horizon;
      observations.push({
        assetId: mapping.assetId,
        asOfDate: rows[index].tradeDate,
        featureAvailableDate,
        targetDate: rows[targetIndex].tradeDate,
        score,
        forwardReturn: adjustedCloses[targetIndex] / adjustedCloses[index] - 1,
      });
    }
  }
  return observations.sort(
    (left, right) =>
      left.assetId.localeCompare(right.assetId) || left.asOfDate.localeCompare(right.asOfDate),
  );
}

export function timeSeriesFactorUsesCommodityCarry(factor: CompiledTimeSeriesFactor): boolean {
  return factor.inputs.length === 1 && factor.inputs[0] === COMMODITY_CARRY_FIELD;
}

function assertCommodityCarryTimeSeriesProtocol(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  factor: CompiledTimeSeriesFactor,
): CommodityCarryTimeSeriesMapping[] {
  if (
    researchSpec.observationFrequency !== 'daily' ||
    researchSpec.target.horizonUnit !== 'trade_day' ||
    factor.analysisKind !== 'time_series' ||
    factor.outputScope !== 'asset' ||
    factor.frequency !== 'daily' ||
    !timeSeriesFactorUsesCommodityCarry(factor) ||
    !factor.targetAssetClasses.includes('commodity')
  ) {
    throw new Error('Commodity carry time-series research requires the frozen daily protocol.');
  }
  const available = new Map(
    COMMODITY_CARRY_TIME_SERIES_MAPPINGS.map((mapping) => [mapping.assetId, mapping]),
  );
  const mappings = researchSpec.assets.map((assetId) => {
    const mapping = available.get(assetId);
    if (!mapping) {
      throw new Error(`Commodity carry time-series research does not map ETF ${assetId}.`);
    }
    return mapping;
  });
  if (
    mappings.length === 0 ||
    new Set(mappings.map((item) => item.assetId)).size !== mappings.length
  ) {
    throw new Error('Commodity carry time-series research requires unique mapped ETFs.');
  }
  return mappings;
}

function groupAndValidateEtfRows(
  rows: EtfTrendDailyRow[],
  mappings: CommodityCarryTimeSeriesMapping[],
): Map<string, EtfTrendDailyRow[]> {
  const declared = new Set(mappings.map((mapping) => mapping.assetId));
  const result = new Map<string, EtfTrendDailyRow[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.assetId}:${row.tradeDate}`;
    if (
      !declared.has(row.assetId) ||
      seen.has(key) ||
      !/^\d{8}$/.test(row.tradeDate) ||
      !Number.isFinite(row.close) ||
      row.close <= 0 ||
      !Number.isFinite(row.adjustmentFactor) ||
      row.adjustmentFactor <= 0
    ) {
      throw new Error(`Invalid commodity carry ETF row ${key}.`);
    }
    seen.add(key);
    const bucket = result.get(row.assetId) ?? [];
    bucket.push({ ...row });
    result.set(row.assetId, bucket);
  }
  return result;
}

function groupAndValidateCarryPoints(
  points: CommodityCarryPointV1[],
  mappings: CommodityCarryTimeSeriesMapping[],
): Map<string, CommodityCarryPointV1[]> {
  const declared = new Set(mappings.map((mapping) => mapping.productCode));
  const result = new Map<string, CommodityCarryPointV1[]>();
  const seen = new Set<string>();
  for (const point of points) {
    const key = `${point.productCode}:${point.asOfDate}`;
    if (
      !declared.has(point.productCode) ||
      seen.has(key) ||
      !/^\d{8}$/.test(point.asOfDate) ||
      !/^\d{8}$/.test(point.availableDate) ||
      point.availableDate <= point.asOfDate ||
      !Number.isFinite(point.annualizedLogCarry)
    ) {
      throw new Error(`Invalid commodity carry time-series point ${key}.`);
    }
    seen.add(key);
    const bucket = result.get(point.productCode) ?? [];
    bucket.push({ ...point });
    result.set(point.productCode, bucket);
  }
  return result;
}

function alignCarryToEtfDates(
  rows: EtfTrendDailyRow[],
  points: CommodityCarryPointV1[],
): { values: number[]; availableDates: string[] } {
  const values: number[] = [];
  const availableDates: string[] = [];
  let position = 0;
  let latest: CommodityCarryPointV1 | null = null;
  for (const row of rows) {
    while (position < points.length && points[position].availableDate <= row.tradeDate) {
      latest = points[position];
      position++;
    }
    if (
      !latest ||
      daysBetween(latest.availableDate, row.tradeDate) > COMMODITY_CARRY_MAX_STALENESS_DAYS
    ) {
      values.push(Number.NaN);
      availableDates.push('');
      continue;
    }
    values.push(latest.annualizedLogCarry);
    availableDates.push(latest.availableDate);
  }
  return { values, availableDates };
}
