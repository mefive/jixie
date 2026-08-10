import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { COMMODITY_FUTURE_SPECS } from '../commodity/commodity-futures.js';
import { isAuditedAuKilogramMislabelDate } from '../commodity/commodity-warehouse-receipts.js';
import { addDays, daysBetween } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import type { CompiledTimeSeriesFactor } from './compile-time-series-factor.js';
import type { EtfTrendDailyRow } from './etf-trend-observations.js';
import { COMMODITY_WAREHOUSE_RECEIPT_VOLUME_FIELD } from './factor-v2-fields.js';
import type { TimeSeriesEvaluationObservation } from './time-series-evaluator.js';

export const COMMODITY_WAREHOUSE_RECEIPT_MAX_STALENESS_DAYS = 7;

export interface CommodityWarehouseReceiptResearchPoint {
  productCode: string;
  tradeDate: string;
  availableDate: string;
  sourceName: string;
  sourceUnit: string | null;
  unit: string;
  unitCorrectionApplied: boolean;
  volume: number;
  sourceRowCount: number;
}

interface CommodityWarehouseReceiptTimeSeriesMapping {
  productCode: string;
  assetId: string;
  sourceName: string;
  unit: string;
}

const COMMODITY_WAREHOUSE_RECEIPT_TIME_SERIES_MAPPINGS: CommodityWarehouseReceiptTimeSeriesMapping[] =
  COMMODITY_FUTURE_SPECS.filter(
    (specification) => specification.warehouseReceipt.units.length === 1,
  ).map((specification) => ({
    productCode: specification.productCode,
    assetId: specification.targetEtf,
    sourceName: specification.warehouseReceipt.sourceName,
    unit: specification.warehouseReceipt.units[0],
  }));

/** Tests a product-local warehouse-receipt transform against its mapped adjusted ETF return. */
export async function loadCommodityWarehouseReceiptTimeSeriesObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  factor: CompiledTimeSeriesFactor,
): Promise<TimeSeriesEvaluationObservation[]> {
  const mappings = assertCommodityWarehouseReceiptTimeSeriesProtocol(researchSpec, factor);
  const historyStart = addDays(
    researchSpec.start,
    -(factor.window - 1 + researchSpec.target.horizon) * 3,
  );
  const upperBound = researchSpec.dataPolicy.dataCutoff ?? undefined;
  const [bars, adjustments, warehouseReceiptPoints, metadata] = await Promise.all([
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
    prisma.commodityWarehouseReceipt.findMany({
      where: {
        productCode: { in: mappings.map((mapping) => mapping.productCode) },
        availableDate: {
          gte: addDays(historyStart, -COMMODITY_WAREHOUSE_RECEIPT_MAX_STALENESS_DAYS),
          ...(upperBound ? { lte: upperBound } : {}),
        },
      },
      select: {
        productCode: true,
        tradeDate: true,
        availableDate: true,
        sourceName: true,
        sourceUnit: true,
        unit: true,
        unitCorrectionApplied: true,
        volume: true,
        sourceRowCount: true,
      },
      orderBy: [{ productCode: 'asc' }, { availableDate: 'asc' }, { unit: 'asc' }],
    }),
    prisma.etfBasic.findMany({
      where: { tsCode: { in: researchSpec.assets } },
      select: { tsCode: true },
    }),
  ]);
  if (metadata.length !== researchSpec.assets.length) {
    throw new Error('Commodity warehouse-receipt research requires every mapped ETF.');
  }
  const adjustmentByAssetDate = new Map(
    adjustments.map((row) => [`${row.tsCode}:${row.tradeDate}`, row.adjFactor]),
  );

  return buildCommodityWarehouseReceiptTimeSeriesObservations(
    researchSpec,
    bars.map((bar) => ({
      assetId: bar.tsCode,
      tradeDate: bar.tradeDate,
      close: bar.close!,
      adjustmentFactor: adjustmentByAssetDate.get(`${bar.tsCode}:${bar.tradeDate}`) ?? Number.NaN,
    })),
    warehouseReceiptPoints,
    factor,
  );
}

export async function buildCommodityWarehouseReceiptTimeSeriesObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  etfRows: EtfTrendDailyRow[],
  warehouseReceiptPoints: CommodityWarehouseReceiptResearchPoint[],
  factor: CompiledTimeSeriesFactor,
): Promise<TimeSeriesEvaluationObservation[]> {
  const mappings = assertCommodityWarehouseReceiptTimeSeriesProtocol(researchSpec, factor);
  const rowsByAsset = groupAndValidateEtfRows(etfRows, mappings);
  const pointsByProduct = groupAndValidateWarehouseReceiptPoints(warehouseReceiptPoints, mappings);
  const observations: TimeSeriesEvaluationObservation[] = [];

  for (const mapping of mappings) {
    const rows = (rowsByAsset.get(mapping.assetId) ?? []).sort((left, right) =>
      left.tradeDate.localeCompare(right.tradeDate),
    );
    const adjustedCloses = rows.map((row) => row.close * row.adjustmentFactor);
    const productPoints = (pointsByProduct.get(mapping.productCode) ?? []).sort((left, right) =>
      left.availableDate.localeCompare(right.availableDate),
    );
    const aligned = alignWarehouseReceiptsToEtfDates(rows, productPoints);
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
    const scores = await factor.computeSeries(
      { [COMMODITY_WAREHOUSE_RECEIPT_VOLUME_FIELD]: aligned.values },
      indexes,
    );
    if (scores.length !== indexes.length) {
      throw new Error('Commodity warehouse-receipt factor returned an unexpected score count.');
    }
    for (let position = 0; position < indexes.length; position++) {
      const index = indexes[position];
      const score = scores[position];
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

export function timeSeriesFactorUsesCommodityWarehouseReceipts(
  factor: CompiledTimeSeriesFactor,
): boolean {
  return (
    factor.inputs.length === 1 && factor.inputs[0] === COMMODITY_WAREHOUSE_RECEIPT_VOLUME_FIELD
  );
}

function assertCommodityWarehouseReceiptTimeSeriesProtocol(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  factor: CompiledTimeSeriesFactor,
): CommodityWarehouseReceiptTimeSeriesMapping[] {
  if (
    researchSpec.observationFrequency !== 'daily' ||
    researchSpec.target.horizonUnit !== 'trade_day' ||
    factor.analysisKind !== 'time_series' ||
    factor.outputScope !== 'asset' ||
    factor.frequency !== 'daily' ||
    !timeSeriesFactorUsesCommodityWarehouseReceipts(factor) ||
    !factor.targetAssetClasses.includes('commodity')
  ) {
    throw new Error(
      'Commodity warehouse-receipt time-series research requires the frozen daily protocol.',
    );
  }
  const available = new Map(
    COMMODITY_WAREHOUSE_RECEIPT_TIME_SERIES_MAPPINGS.map((mapping) => [mapping.assetId, mapping]),
  );
  const mappings = researchSpec.assets.map((assetId) => {
    const mapping = available.get(assetId);
    if (!mapping) {
      throw new Error(`Commodity warehouse-receipt research does not map ETF ${assetId}.`);
    }
    return mapping;
  });
  if (
    mappings.length === 0 ||
    new Set(mappings.map((mapping) => mapping.assetId)).size !== mappings.length
  ) {
    throw new Error('Commodity warehouse-receipt research requires unique mapped ETFs.');
  }
  return mappings;
}

function groupAndValidateEtfRows(
  rows: EtfTrendDailyRow[],
  mappings: CommodityWarehouseReceiptTimeSeriesMapping[],
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
      throw new Error(`Invalid commodity warehouse-receipt ETF row ${key}.`);
    }
    seen.add(key);
    const bucket = result.get(row.assetId) ?? [];
    bucket.push({ ...row });
    result.set(row.assetId, bucket);
  }
  return result;
}

function groupAndValidateWarehouseReceiptPoints(
  points: CommodityWarehouseReceiptResearchPoint[],
  mappings: CommodityWarehouseReceiptTimeSeriesMapping[],
): Map<string, CommodityWarehouseReceiptResearchPoint[]> {
  const mappingByProduct = new Map(mappings.map((mapping) => [mapping.productCode, mapping]));
  const result = new Map<string, CommodityWarehouseReceiptResearchPoint[]>();
  const seen = new Set<string>();
  for (const point of points) {
    const mapping = mappingByProduct.get(point.productCode);
    const key = `${point.productCode}:${point.tradeDate}:${point.unit}`;
    const validAuCorrection =
      point.productCode === 'AU' &&
      point.sourceUnit === '吨' &&
      point.unit === '千克' &&
      isAuditedAuKilogramMislabelDate(point.tradeDate);
    if (
      !mapping ||
      seen.has(key) ||
      !/^\d{8}$/.test(point.tradeDate) ||
      !/^\d{8}$/.test(point.availableDate) ||
      point.availableDate <= point.tradeDate ||
      point.sourceName !== mapping.sourceName ||
      point.unit !== mapping.unit ||
      !point.sourceUnit ||
      (point.unitCorrectionApplied && !validAuCorrection) ||
      (!point.unitCorrectionApplied && point.sourceUnit !== point.unit) ||
      !Number.isFinite(point.volume) ||
      point.volume < 0 ||
      !Number.isInteger(point.sourceRowCount) ||
      point.sourceRowCount <= 0
    ) {
      throw new Error(`Invalid commodity warehouse-receipt time-series point ${key}.`);
    }
    seen.add(key);
    const bucket = result.get(point.productCode) ?? [];
    bucket.push({ ...point });
    result.set(point.productCode, bucket);
  }
  return result;
}

function alignWarehouseReceiptsToEtfDates(
  rows: EtfTrendDailyRow[],
  points: CommodityWarehouseReceiptResearchPoint[],
): { values: number[]; availableDates: string[] } {
  const values: number[] = [];
  const availableDates: string[] = [];
  let position = 0;
  let latest: CommodityWarehouseReceiptResearchPoint | null = null;

  for (const row of rows) {
    while (position < points.length && points[position].availableDate <= row.tradeDate) {
      latest = points[position];
      position++;
    }
    if (
      !latest ||
      daysBetween(latest.availableDate, row.tradeDate) >
        COMMODITY_WAREHOUSE_RECEIPT_MAX_STALENESS_DAYS
    ) {
      values.push(Number.NaN);
      availableDates.push('');
      continue;
    }
    values.push(latest.volume);
    availableDates.push(latest.availableDate);
  }

  return { values, availableDates };
}
