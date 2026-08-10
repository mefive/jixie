import type { MultiAssetClass, PanelFactorResearchSpecV1 } from '@jixie/shared';
import {
  COMMODITY_CARRY_MINIMUM_DAYS_TO_DELIVERY,
  loadCommodityCarryHistory,
  type CommodityCarryPointV1,
} from '../commodity/commodity-carry.js';
import { COMMODITY_FUTURE_SPECS } from '../commodity/commodity-futures.js';
import { addDays, daysBetween } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import type { CompiledPanelFactor } from './compile-time-series-factor.js';
import { COMMODITY_CARRY_PANEL_FIELD } from './factor-v2-fields.js';
import type { PanelEvaluationObservation } from './panel-evaluator.js';
import {
  monthlyPanelDecisionDates,
  panelEtfMatchesAssetClass,
  trailingPanelVolatility,
  validatePanelCalendar,
  type PanelEtfDailyRow,
  type PanelEtfMetadata,
} from './panel-observations.js';

export { COMMODITY_CARRY_PANEL_FIELD };
export const COMMODITY_CARRY_MAX_STALENESS_DAYS = 7;

export const COMMODITY_CARRY_PANEL_ASSETS: PanelFactorResearchSpecV1['assets'] =
  COMMODITY_FUTURE_SPECS.map((spec) => ({
    assetId: spec.targetEtf,
    assetClass: spec.targetAssetClass,
  }));

interface CommodityCarryAssetMapping {
  productCode: string;
  assetId: string;
  assetClass: MultiAssetClass;
}

const COMMODITY_CARRY_ASSET_MAPPINGS: CommodityCarryAssetMapping[] = COMMODITY_FUTURE_SPECS.map(
  (spec) => ({
    productCode: spec.productCode,
    assetId: spec.targetEtf,
    assetClass: spec.targetAssetClass,
  }),
);

/** Joins one product's actual-contract curve to its ETF return target. Curve construction and ETF
 * execution remain separate: the future contract is a feature source, never the traded asset. */
export async function loadCommodityCarryPanelObservations(
  researchSpec: PanelFactorResearchSpecV1,
  factor: CompiledPanelFactor,
): Promise<PanelEvaluationObservation[]> {
  assertCommodityCarryPanelProtocol(researchSpec, factor);
  const assetIds = researchSpec.assets.map((asset) => asset.assetId);
  const historyStart = addDays(researchSpec.start, -120);
  const targetEnd = addDays(researchSpec.end, (researchSpec.target.horizon + 10) * 3);
  const upperBound = researchSpec.dataPolicy.dataCutoff
    ? minimumDate(researchSpec.dataPolicy.dataCutoff, targetEnd)
    : targetEnd;
  const [bars, adjustments, calendar, metadata, carryPoints] = await Promise.all([
    prisma.etfDaily.findMany({
      where: {
        tsCode: { in: assetIds },
        tradeDate: { gte: historyStart, lte: upperBound },
        close: { not: null },
      },
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    prisma.etfAdjFactor.findMany({
      where: { tsCode: { in: assetIds }, tradeDate: { gte: historyStart, lte: upperBound } },
      select: { tsCode: true, tradeDate: true, adjFactor: true },
    }),
    prisma.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: historyStart, lte: upperBound },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
    prisma.etfBasic.findMany({
      where: { tsCode: { in: assetIds } },
      select: {
        tsCode: true,
        name: true,
        indexCode: true,
        indexName: true,
        fundType: true,
        etfType: true,
      },
    }),
    loadCommodityCarryHistory({
      start: historyStart,
      end: researchSpec.end,
      productCodes: COMMODITY_CARRY_ASSET_MAPPINGS.filter((mapping) =>
        assetIds.includes(mapping.assetId),
      ).map((mapping) => mapping.productCode),
      minimumDaysToDelivery: COMMODITY_CARRY_MINIMUM_DAYS_TO_DELIVERY,
    }),
  ]);
  if (metadata.length !== assetIds.length) {
    throw new Error('Commodity carry panel requires metadata for every target ETF.');
  }
  const declaredClasses = new Map(
    researchSpec.assets.map((asset) => [asset.assetId, asset.assetClass]),
  );
  for (const asset of metadata) {
    const row: PanelEtfMetadata = {
      assetId: asset.tsCode,
      name: asset.name,
      indexCode: asset.indexCode,
      indexName: asset.indexName,
      fundType: asset.fundType,
      etfType: asset.etfType,
    };
    if (!panelEtfMatchesAssetClass(row, declaredClasses.get(asset.tsCode)!)) {
      throw new Error(`ETF ${asset.tsCode} does not match its commodity panel asset class.`);
    }
  }
  const adjustmentByAssetDate = new Map(
    adjustments.map((row) => [`${row.tsCode}:${row.tradeDate}`, row.adjFactor]),
  );
  return buildCommodityCarryPanelObservations(
    researchSpec,
    bars.map((bar) => ({
      assetId: bar.tsCode,
      tradeDate: bar.tradeDate,
      close: bar.close!,
      adjustmentFactor: adjustmentByAssetDate.get(`${bar.tsCode}:${bar.tradeDate}`) ?? Number.NaN,
    })),
    calendar.map((row) => row.calDate),
    carryPoints,
    factor,
  );
}

export async function buildCommodityCarryPanelObservations(
  researchSpec: PanelFactorResearchSpecV1,
  etfRows: PanelEtfDailyRow[],
  openDates: string[],
  carryPoints: CommodityCarryPointV1[],
  factor: CompiledPanelFactor,
): Promise<PanelEvaluationObservation[]> {
  assertCommodityCarryPanelProtocol(researchSpec, factor);
  const mappings = selectedMappings(researchSpec);
  const calendar = validatePanelCalendar(openDates);
  const decisionDates = monthlyPanelDecisionDates(calendar, researchSpec.start, researchSpec.end);
  const calendarIndex = new Map(calendar.map((date, index) => [date, index]));
  const rowsByAsset = groupAndValidateEtfRows(etfRows, mappings);
  const carryByProduct = groupAndValidateCarryPoints(carryPoints, mappings);
  const observations: PanelEvaluationObservation[] = [];

  for (const mapping of mappings) {
    const rows = (rowsByAsset.get(mapping.assetId) ?? []).sort((left, right) =>
      left.tradeDate.localeCompare(right.tradeDate),
    );
    const dateIndex = new Map(rows.map((row, index) => [row.tradeDate, index]));
    const adjustedCloses = rows.map((row) => row.close * row.adjustmentFactor);
    const productCarry = (carryByProduct.get(mapping.productCode) ?? []).sort((left, right) =>
      left.asOfDate.localeCompare(right.asOfDate),
    );
    const carryIndexes: number[] = [];
    const eligible: Array<{
      asOfDate: string;
      targetDate: string;
      priceIndex: number;
      carryPoint: CommodityCarryPointV1;
    }> = [];

    for (const asOfDate of decisionDates) {
      const targetDate = calendar[calendarIndex.get(asOfDate)! + researchSpec.target.horizon];
      if (
        !targetDate ||
        (researchSpec.dataPolicy.dataCutoff && targetDate > researchSpec.dataPolicy.dataCutoff)
      ) {
        continue;
      }
      const priceIndex = dateIndex.get(asOfDate);
      const targetIndex = dateIndex.get(targetDate);
      if (
        priceIndex == null ||
        targetIndex == null ||
        priceIndex < 20 ||
        targetIndex <= priceIndex
      ) {
        continue;
      }
      const carryIndex = latestPointIndex(productCarry, asOfDate);
      if (carryIndex == null) {
        continue;
      }
      const carryPoint = productCarry[carryIndex];
      if (
        !carryPoint ||
        carryIndex < factor.window - 1 ||
        carryPoint.availableDate > asOfDate ||
        daysBetween(carryPoint.availableDate, asOfDate) > COMMODITY_CARRY_MAX_STALENESS_DAYS
      ) {
        continue;
      }
      carryIndexes.push(carryIndex);
      eligible.push({ asOfDate, targetDate, priceIndex, carryPoint });
    }

    const scores = await factor.computeSeries(
      { [COMMODITY_CARRY_PANEL_FIELD]: productCarry.map((point) => point.annualizedLogCarry) },
      carryIndexes,
    );
    if (scores.length !== eligible.length) {
      throw new Error('Commodity carry panel factor returned an unexpected score count.');
    }
    for (let index = 0; index < eligible.length; index++) {
      const score = scores[index];
      if (score == null) {
        continue;
      }
      const row = eligible[index];
      const targetIndex = dateIndex.get(row.targetDate)!;
      observations.push({
        assetId: mapping.assetId,
        assetClass: mapping.assetClass,
        asOfDate: row.asOfDate,
        featureAvailableDate: row.carryPoint.availableDate,
        targetDate: row.targetDate,
        score,
        forwardReturn: adjustedCloses[targetIndex] / adjustedCloses[row.priceIndex] - 1,
        volatility: trailingPanelVolatility(adjustedCloses, row.priceIndex, 20),
      });
    }
  }
  return observations.sort(
    (left, right) =>
      left.asOfDate.localeCompare(right.asOfDate) || left.assetId.localeCompare(right.assetId),
  );
}

export function panelFactorUsesCommodityCarry(factor: CompiledPanelFactor): boolean {
  return factor.inputs.length === 1 && factor.inputs[0] === COMMODITY_CARRY_PANEL_FIELD;
}

function assertCommodityCarryPanelProtocol(
  researchSpec: PanelFactorResearchSpecV1,
  factor: CompiledPanelFactor,
): void {
  if (
    researchSpec.observationFrequency !== 'monthly' ||
    researchSpec.target.horizonUnit !== 'trade_day' ||
    !panelFactorUsesCommodityCarry(factor) ||
    factor.analysisKind !== 'panel' ||
    factor.outputScope !== 'asset' ||
    factor.frequency !== 'daily' ||
    !factor.targetAssetClasses.includes('commodity')
  ) {
    throw new Error('Commodity carry panel requires the frozen monthly commodity protocol.');
  }
  selectedMappings(researchSpec);
}

function selectedMappings(researchSpec: PanelFactorResearchSpecV1): CommodityCarryAssetMapping[] {
  const available = new Map(COMMODITY_CARRY_ASSET_MAPPINGS.map((row) => [row.assetId, row]));
  const selected = researchSpec.assets.map((asset) => {
    const mapping = available.get(asset.assetId);
    if (!mapping || mapping.assetClass !== asset.assetClass) {
      throw new Error(`Commodity carry panel does not map ETF ${asset.assetId}.`);
    }
    return mapping;
  });
  if (selected.length < 3 || new Set(selected.map((row) => row.assetId)).size !== selected.length) {
    throw new Error('Commodity carry panel requires at least three unique mapped ETFs.');
  }
  return selected;
}

function groupAndValidateEtfRows(
  rows: PanelEtfDailyRow[],
  mappings: CommodityCarryAssetMapping[],
): Map<string, PanelEtfDailyRow[]> {
  const declared = new Set(mappings.map((mapping) => mapping.assetId));
  const grouped = new Map<string, PanelEtfDailyRow[]>();
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
      throw new Error(`Invalid commodity panel ETF row ${key}.`);
    }
    seen.add(key);
    const bucket = grouped.get(row.assetId) ?? [];
    bucket.push(row);
    grouped.set(row.assetId, bucket);
  }
  return grouped;
}

function groupAndValidateCarryPoints(
  points: CommodityCarryPointV1[],
  mappings: CommodityCarryAssetMapping[],
): Map<string, CommodityCarryPointV1[]> {
  const declared = new Set(mappings.map((mapping) => mapping.productCode));
  const grouped = new Map<string, CommodityCarryPointV1[]>();
  const seen = new Set<string>();
  for (const point of points) {
    const key = `${point.productCode}:${point.asOfDate}`;
    if (
      !declared.has(point.productCode) ||
      seen.has(key) ||
      point.availableDate > point.asOfDate ||
      !Number.isFinite(point.annualizedLogCarry)
    ) {
      throw new Error(`Invalid commodity carry panel point ${key}.`);
    }
    seen.add(key);
    const bucket = grouped.get(point.productCode) ?? [];
    bucket.push(point);
    grouped.set(point.productCode, bucket);
  }
  return grouped;
}

function latestPointIndex(points: CommodityCarryPointV1[], date: string): number | null {
  let result: number | null = null;
  for (let index = 0; index < points.length; index++) {
    if (points[index].availableDate > date) {
      break;
    }
    result = index;
  }
  return result;
}

function minimumDate(left: string, right: string): string {
  return left < right ? left : right;
}
