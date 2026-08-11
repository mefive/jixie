import { prisma, type Prisma } from '../lib/prisma.js';
import {
  COMMODITY_CONTINUOUS_RETURN_METHOD,
  COMMODITY_CONTINUOUS_RETURN_SOURCE,
  COMMODITY_CONTINUOUS_RETURN_VERSION,
  computeCommodityContinuousReturns,
  type CommodityContinuousReturnPointV1,
} from './commodity-continuous-returns.js';
import { COMMODITY_MAIN_CONTRACT_SPECS } from './commodity-futures.js';

export type CommodityContinuousReturnQualityStatus = 'pass' | 'warn' | 'error';

export interface CommodityContinuousReturnQualityProduct {
  productCode: string;
  expectedOpenDates: number;
  mappingDates: number;
  mappingCoverage: number;
  expectedReturns: number;
  storedReturns: number;
  returnSourceCoverage: number;
  rollDays: number;
  latestMappingDate: string | null;
  latestReturnDate: string | null;
  trailingMappingGaps: number;
}

export interface CommodityContinuousReturnQualitySummary {
  status: CommodityContinuousReturnQualityStatus;
  rows: number;
  invalidRows: number;
  products: CommodityContinuousReturnQualityProduct[];
  errors: string[];
  warnings: string[];
}

export async function auditCommodityContinuousReturns(
  options: { startDate: string; endDate: string },
  database: Prisma = prisma,
): Promise<CommodityContinuousReturnQualitySummary> {
  const continuousCodes = COMMODITY_MAIN_CONTRACT_SPECS.map(
    (specification) => specification.continuousCode,
  );
  const [stored, expected, mappings, calendar] = await Promise.all([
    database.commodityContinuousReturn.findMany({
      where: { tradeDate: { gte: options.startDate, lte: options.endDate } },
      orderBy: [{ productCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    computeCommodityContinuousReturns(options.startDate, options.endDate, database),
    database.futureMapping.findMany({
      where: {
        continuousCode: { in: continuousCodes },
        tradeDate: { gte: options.startDate, lte: options.endDate },
      },
      select: { continuousCode: true, tradeDate: true },
    }),
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: options.startDate, lte: options.endDate },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
  ]);

  const expectedByKey = new Map(
    expected.map((point) => [`${point.productCode}|${point.tradeDate}`, point]),
  );
  const storedKeys = new Set<string>();
  let invalidRows = 0;
  for (const row of stored) {
    const key = `${row.productCode}|${row.tradeDate}`;
    const expectedPoint = expectedByKey.get(key);
    if (storedKeys.has(key) || !expectedPoint || !matchesPoint(row, expectedPoint)) {
      invalidRows++;
    }
    storedKeys.add(key);
  }
  invalidRows += expected.filter(
    (point) => !storedKeys.has(`${point.productCode}|${point.tradeDate}`),
  ).length;

  const products = COMMODITY_MAIN_CONTRACT_SPECS.map(
    (specification): CommodityContinuousReturnQualityProduct => {
      const expectedOpenDates = calendar
        .map((row) => row.calDate)
        .filter((date) => date >= specification.startDate);
      const productMappings = mappings
        .filter((row) => row.continuousCode === specification.continuousCode)
        .map((row) => row.tradeDate)
        .sort();
      const expectedPoints = expected.filter(
        (point) => point.productCode === specification.productCode,
      );
      const storedPoints = stored.filter(
        (point) => point.productCode === specification.productCode,
      );
      const latestMappingDate = productMappings.at(-1) ?? null;
      const maximumIntervals = Math.max(0, productMappings.length - 1);
      return {
        productCode: specification.productCode,
        expectedOpenDates: expectedOpenDates.length,
        mappingDates: productMappings.length,
        mappingCoverage:
          expectedOpenDates.length === 0 ? 0 : productMappings.length / expectedOpenDates.length,
        expectedReturns: expectedPoints.length,
        storedReturns: storedPoints.length,
        returnSourceCoverage: maximumIntervals === 0 ? 0 : expectedPoints.length / maximumIntervals,
        rollDays: storedPoints.filter((point) => point.mappingChanged).length,
        latestMappingDate,
        latestReturnDate: storedPoints.at(-1)?.tradeDate ?? null,
        trailingMappingGaps:
          latestMappingDate == null
            ? expectedOpenDates.length
            : expectedOpenDates.filter((date) => date > latestMappingDate).length,
      };
    },
  );

  const errors: string[] = [];
  const warnings: string[] = [];
  if (invalidRows > 0) {
    errors.push(`${invalidRows} stored return rows differ from the reproducible mapping ledger`);
  }
  for (const product of products) {
    if (product.mappingDates === 0 || product.storedReturns === 0) {
      errors.push(`${product.productCode} has no auditable main-contract return history`);
      continue;
    }
    if (
      product.mappingCoverage < 0.95 ||
      product.returnSourceCoverage < 0.95 ||
      product.trailingMappingGaps > 3
    ) {
      errors.push(
        `${product.productCode} mapping/return coverage is ${(product.mappingCoverage * 100).toFixed(2)}%/${(product.returnSourceCoverage * 100).toFixed(2)}% with ${product.trailingMappingGaps} trailing mapping gaps`,
      );
    } else if (
      product.mappingCoverage < 0.99 ||
      product.returnSourceCoverage < 0.99 ||
      product.trailingMappingGaps > 0
    ) {
      warnings.push(
        `${product.productCode} mapping/return coverage is ${(product.mappingCoverage * 100).toFixed(2)}%/${(product.returnSourceCoverage * 100).toFixed(2)}% with ${product.trailingMappingGaps} trailing mapping gaps`,
      );
    }
  }
  return {
    status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'pass',
    rows: stored.length,
    invalidRows,
    products,
    errors,
    warnings,
  };
}

function matchesPoint(
  stored: {
    version: number;
    source: string;
    productCode: string;
    tradeDate: string;
    availableDate: string;
    continuousCode: string;
    mappingMethod: string;
    mappedContract: string;
    previousTradeDate: string;
    previousMappedContract: string;
    settlement: number;
    sameContractPreviousSettlement: number;
    previousMappedSettlement: number;
    continuousReturn: number;
    continuousLogReturn: number;
    mappedLogReturn: number;
    rollGapLogReturn: number;
    rollYieldProxy: number;
    mappingChanged: boolean;
  },
  expected: CommodityContinuousReturnPointV1,
): boolean {
  return (
    stored.version === COMMODITY_CONTINUOUS_RETURN_VERSION &&
    stored.source === COMMODITY_CONTINUOUS_RETURN_SOURCE &&
    stored.mappingMethod === COMMODITY_CONTINUOUS_RETURN_METHOD &&
    stored.productCode === expected.productCode &&
    stored.tradeDate === expected.tradeDate &&
    stored.availableDate === expected.availableDate &&
    stored.continuousCode === expected.continuousCode &&
    stored.mappedContract === expected.mappedContract &&
    stored.previousTradeDate === expected.previousTradeDate &&
    stored.previousMappedContract === expected.previousMappedContract &&
    stored.mappingChanged === expected.mappingChanged &&
    close(stored.settlement, expected.settlement) &&
    close(stored.sameContractPreviousSettlement, expected.sameContractPreviousSettlement) &&
    close(stored.previousMappedSettlement, expected.previousMappedSettlement) &&
    close(stored.continuousReturn, expected.continuousReturn) &&
    close(stored.continuousLogReturn, expected.continuousLogReturn) &&
    close(stored.mappedLogReturn, expected.mappedLogReturn) &&
    close(stored.rollGapLogReturn, expected.rollGapLogReturn) &&
    close(stored.rollYieldProxy, expected.rollYieldProxy)
  );
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-12 * Math.max(1, Math.abs(left), Math.abs(right));
}
