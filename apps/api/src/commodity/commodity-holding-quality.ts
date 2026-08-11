import { prisma, type Prisma } from '../lib/prisma.js';
import { addDays } from '../lib/date.js';
import {
  COMMODITY_HOLDING_POSITION_VERSION,
  COMMODITY_HOLDING_SELECTION_METHOD,
  COMMODITY_HOLDING_SOURCE,
  loadCommodityHoldingRepresentatives,
  type CommodityHoldingRepresentative,
} from './commodity-holding-positions.js';
import { COMMODITY_HOLDING_SPECS } from './commodity-futures.js';

export type CommodityHoldingQualityStatus = 'pass' | 'warn' | 'error';

export interface CommodityHoldingQualityRow {
  version: number;
  source: string;
  productCode: string;
  tradeDate: string;
  availableDate: string;
  exchange: string;
  referenceContract: string;
  sourceSymbol: string;
  selectionMethod: string;
  contractOpenInterest: number;
  contractVolume: number;
  rankedVolume: number;
  rankedVolumeChange: number | null;
  rankedLongHolding: number;
  rankedLongChange: number | null;
  rankedShortHolding: number;
  rankedShortChange: number | null;
  topFiveLongHolding: number;
  topFiveShortHolding: number;
  volumeMemberCount: number;
  longMemberCount: number;
  shortMemberCount: number;
  sourceRowCount: number;
  excludedSummaryRowCount: number;
  sourceCorrectionApplied: boolean;
}

export interface CommodityHoldingProductQuality {
  productCode: string;
  expectedDates: number;
  observedDates: number;
  missingDates: number;
  coverage: number;
  latestExpectedDate: string | null;
  latestObservedDate: string | null;
  trailingMissingDates: number;
}

export interface CommodityHoldingQualitySummary {
  status: CommodityHoldingQualityStatus;
  rows: number;
  invalidRows: number;
  products: CommodityHoldingProductQuality[];
  errors: string[];
  warnings: string[];
}

export async function auditCommodityHoldingPositions(
  options: { startDate: string; endDate: string },
  database: Prisma = prisma,
): Promise<CommodityHoldingQualitySummary> {
  const [rows, representatives, calendarRows] = await Promise.all([
    database.commodityHoldingPosition.findMany({
      where: { tradeDate: { gte: options.startDate, lte: options.endDate } },
      orderBy: [{ productCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    loadCommodityHoldingRepresentatives(options.startDate, options.endDate, database),
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: options.startDate, lte: addDays(options.endDate, 14) },
      },
      select: { calDate: true },
    }),
  ]);
  return summarizeCommodityHoldingQuality(
    rows,
    representatives,
    new Set(calendarRows.map((row) => row.calDate)),
  );
}

export function summarizeCommodityHoldingQuality(
  rows: CommodityHoldingQualityRow[],
  representatives: CommodityHoldingRepresentative[],
  openDates: Set<string>,
): CommodityHoldingQualitySummary {
  const supportedProducts = COMMODITY_HOLDING_SPECS.map(
    (specification) => specification.productCode,
  );
  const representativeByKey = new Map(
    representatives.map((representative) => [
      `${representative.productCode}|${representative.tradeDate}`,
      representative,
    ]),
  );
  const observedKeys = new Set<string>();
  let invalidRows = 0;
  for (const row of rows) {
    const key = `${row.productCode}|${row.tradeDate}`;
    const representative = representativeByKey.get(key);
    const invalid =
      observedKeys.has(key) ||
      row.version !== COMMODITY_HOLDING_POSITION_VERSION ||
      row.source !== COMMODITY_HOLDING_SOURCE ||
      !supportedProducts.includes(row.productCode as (typeof supportedProducts)[number]) ||
      row.selectionMethod !== COMMODITY_HOLDING_SELECTION_METHOD ||
      row.availableDate <= row.tradeDate ||
      !openDates.has(row.availableDate) ||
      !representative ||
      representative.tsCode !== row.referenceContract ||
      representative.sourceSymbol !== row.sourceSymbol ||
      representative.exchange !== row.exchange ||
      !validNonNegative(row.contractVolume) ||
      !validPositive(row.contractOpenInterest) ||
      !validNonNegative(row.rankedVolume) ||
      !validNonNegative(row.rankedLongHolding) ||
      !validNonNegative(row.rankedShortHolding) ||
      row.rankedLongHolding > row.contractOpenInterest ||
      row.rankedShortHolding > row.contractOpenInterest ||
      !validNonNegative(row.topFiveLongHolding) ||
      !validNonNegative(row.topFiveShortHolding) ||
      row.topFiveLongHolding > row.rankedLongHolding ||
      row.topFiveShortHolding > row.rankedShortHolding ||
      !validOptional(row.rankedVolumeChange) ||
      !validOptional(row.rankedLongChange) ||
      !validOptional(row.rankedShortChange) ||
      !validMemberCount(row.volumeMemberCount) ||
      !validMemberCount(row.longMemberCount) ||
      !validMemberCount(row.shortMemberCount) ||
      !Number.isInteger(row.sourceRowCount) ||
      !Number.isInteger(row.excludedSummaryRowCount) ||
      row.excludedSummaryRowCount < 0 ||
      row.excludedSummaryRowCount > 2 ||
      row.sourceCorrectionApplied !== (row.productCode === 'M' && row.tradeDate === '20201106') ||
      row.sourceRowCount - row.excludedSummaryRowCount <
        Math.max(row.volumeMemberCount, row.longMemberCount, row.shortMemberCount) ||
      row.sourceRowCount > 62;
    if (invalid) {
      invalidRows++;
    }
    observedKeys.add(key);
  }

  const products = supportedProducts.map((productCode): CommodityHoldingProductQuality => {
    const expected = representatives
      .filter((representative) => representative.productCode === productCode)
      .map((representative) => representative.tradeDate)
      .sort();
    const observed = rows
      .filter((row) => row.productCode === productCode)
      .map((row) => row.tradeDate)
      .sort();
    const observedDates = new Set(observed);
    const missingDates = expected.filter((date) => !observedDates.has(date));
    const latestObservedDate = observed.at(-1) ?? null;
    return {
      productCode,
      expectedDates: expected.length,
      observedDates: observed.length,
      missingDates: missingDates.length,
      coverage: expected.length === 0 ? 0 : observed.length / expected.length,
      latestExpectedDate: expected.at(-1) ?? null,
      latestObservedDate,
      trailingMissingDates:
        latestObservedDate == null
          ? expected.length
          : expected.filter((date) => date > latestObservedDate).length,
    };
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  if (invalidRows > 0) {
    errors.push(`${invalidRows} holding rows violate identity, PIT, ranking, or denominator rules`);
  }
  for (const product of products) {
    if (product.expectedDates === 0 || product.observedDates === 0) {
      errors.push(`${product.productCode} has no auditable holding coverage`);
      continue;
    }
    if (product.coverage < 0.9 || product.trailingMissingDates > 3) {
      errors.push(
        `${product.productCode} coverage is ${(product.coverage * 100).toFixed(2)}% with ${product.trailingMissingDates} trailing gaps`,
      );
    } else if (product.coverage < 0.98 || product.trailingMissingDates > 0) {
      warnings.push(
        `${product.productCode} coverage is ${(product.coverage * 100).toFixed(2)}% with ${product.trailingMissingDates} trailing gaps`,
      );
    }
  }
  return {
    status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'pass',
    rows: rows.length,
    invalidRows,
    products,
    errors,
    warnings,
  };
}

function validPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validOptional(value: number | null): boolean {
  return value == null || Number.isFinite(value);
}

function validMemberCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}
