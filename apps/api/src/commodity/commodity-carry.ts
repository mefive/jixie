import { daysBetween } from '../lib/date.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import { COMMODITY_FUTURE_PRODUCT_CODES } from './commodity-futures.js';

export const COMMODITY_CARRY_VERSION = 1 as const;
export const COMMODITY_CARRY_MINIMUM_DAYS_TO_DELIVERY = 10;
export const COMMODITY_CARRY_MINIMUM_TENOR_GAP_DAYS = 7;
export const COMMODITY_CARRY_MAX_STALENESS_DAYS = 7;

export interface CommodityCarryContractBar {
  productCode: string;
  tsCode: string;
  tradeDate: string;
  deliveryDate: string;
  settle: number;
  volume: number;
  openInterest: number;
}

export interface CommodityCarryPointV1 {
  version: typeof COMMODITY_CARRY_VERSION;
  productCode: string;
  asOfDate: string;
  availableDate: string;
  nearContract: string;
  farContract: string;
  nearDeliveryDate: string;
  farDeliveryDate: string;
  nearSettle: number;
  farSettle: number;
  tenorGapDays: number;
  spreadReturn: number;
  annualizedLogCarry: number;
  curveState: 'backwardation' | 'contango' | 'flat';
  nearContractChanged: boolean;
}

export interface LoadCommodityCarryOptions {
  start: string;
  end: string;
  productCodes?: string[];
  minimumDaysToDelivery?: number;
}

/** Loads actual delivery-month settlements and constructs a curve without using a continuous price
 * series. Commodity trading remains disabled; these points are research-only features. */
export async function loadCommodityCarryHistory(
  options: LoadCommodityCarryOptions,
  database: Prisma = prisma,
): Promise<CommodityCarryPointV1[]> {
  assertDateRange(options.start, options.end);
  const productCodes = options.productCodes ?? COMMODITY_FUTURE_PRODUCT_CODES;
  const configuredProducts = new Set<string>(COMMODITY_FUTURE_PRODUCT_CODES);
  if (
    productCodes.length === 0 ||
    new Set(productCodes).size !== productCodes.length ||
    productCodes.some((productCode) => !configuredProducts.has(productCode))
  ) {
    throw new Error('Commodity carry productCodes must be a non-empty unique list.');
  }
  const contracts = await database.futureContract.findMany({
    where: {
      productCode: { in: productCodes },
      listDate: { lte: options.end },
      delistDate: { gte: options.start },
    },
    select: {
      tsCode: true,
      productCode: true,
      listDate: true,
      delistDate: true,
      lastDeliveryDate: true,
    },
  });
  const contractByCode = new Map(contracts.map((contract) => [contract.tsCode, contract]));
  const bars = await database.futureDaily.findMany({
    where: {
      tsCode: { in: contracts.map((contract) => contract.tsCode) },
      tradeDate: { gte: options.start, lte: options.end },
      settle: { not: null },
      volume: { gt: 0 },
      openInterest: { gt: 0 },
    },
    select: {
      tsCode: true,
      tradeDate: true,
      settle: true,
      volume: true,
      openInterest: true,
    },
    orderBy: [{ tradeDate: 'asc' }, { tsCode: 'asc' }],
  });

  return buildCommodityCarryHistory(
    bars.flatMap((bar) => {
      const contract = contractByCode.get(bar.tsCode);
      if (!contract || bar.settle == null || bar.volume == null || bar.openInterest == null) {
        return [];
      }
      return [
        {
          productCode: contract.productCode,
          tsCode: bar.tsCode,
          tradeDate: bar.tradeDate,
          deliveryDate: contract.lastDeliveryDate ?? contract.delistDate,
          settle: bar.settle,
          volume: bar.volume,
          openInterest: bar.openInterest,
        },
      ];
    }),
    { minimumDaysToDelivery: options.minimumDaysToDelivery },
  );
}

export function buildCommodityCarryHistory(
  rows: CommodityCarryContractBar[],
  options: { minimumDaysToDelivery?: number } = {},
): CommodityCarryPointV1[] {
  const minimumDaysToDelivery =
    options.minimumDaysToDelivery ?? COMMODITY_CARRY_MINIMUM_DAYS_TO_DELIVERY;
  if (!Number.isInteger(minimumDaysToDelivery) || minimumDaysToDelivery < 0) {
    throw new Error('Commodity carry minimumDaysToDelivery must be a non-negative integer.');
  }
  const rowsByProductDate = new Map<string, CommodityCarryContractBar[]>();
  for (const row of rows) {
    assertContractBar(row);
    const key = `${row.productCode}:${row.tradeDate}`;
    const bucket = rowsByProductDate.get(key) ?? [];
    if (bucket.some((candidate) => candidate.tsCode === row.tsCode)) {
      throw new Error(`Duplicate commodity future bar ${row.tsCode} ${row.tradeDate}.`);
    }
    bucket.push(row);
    rowsByProductDate.set(key, bucket);
  }

  const previousNearByProduct = new Map<string, string>();
  const points: CommodityCarryPointV1[] = [];
  const sortedBuckets = [...rowsByProductDate.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [, bucket] of sortedBuckets) {
    const eligible = bucket
      .filter((row) => daysBetween(row.tradeDate, row.deliveryDate) >= minimumDaysToDelivery)
      .sort(
        (left, right) =>
          left.deliveryDate.localeCompare(right.deliveryDate) ||
          left.tsCode.localeCompare(right.tsCode),
      );
    if (eligible.length < 2) {
      continue;
    }
    const near = eligible[0]!;
    const far = eligible.find(
      (candidate) =>
        candidate.deliveryDate > near.deliveryDate &&
        daysBetween(near.deliveryDate, candidate.deliveryDate) >=
          COMMODITY_CARRY_MINIMUM_TENOR_GAP_DAYS,
    );
    if (!far) {
      continue;
    }
    const tenorGapDays = daysBetween(near.deliveryDate, far.deliveryDate);
    const spreadReturn = near.settle / far.settle - 1;
    const annualizedLogCarry = (Math.log(near.settle / far.settle) * 365) / tenorGapDays;
    const previousNear = previousNearByProduct.get(near.productCode);
    points.push({
      version: COMMODITY_CARRY_VERSION,
      productCode: near.productCode,
      asOfDate: near.tradeDate,
      availableDate: near.tradeDate,
      nearContract: near.tsCode,
      farContract: far.tsCode,
      nearDeliveryDate: near.deliveryDate,
      farDeliveryDate: far.deliveryDate,
      nearSettle: near.settle,
      farSettle: far.settle,
      tenorGapDays,
      spreadReturn,
      annualizedLogCarry,
      curveState:
        Math.abs(annualizedLogCarry) <= Number.EPSILON
          ? 'flat'
          : annualizedLogCarry > 0
            ? 'backwardation'
            : 'contango',
      nearContractChanged: previousNear != null && previousNear !== near.tsCode,
    });
    previousNearByProduct.set(near.productCode, near.tsCode);
  }
  return points.sort(
    (left, right) =>
      left.asOfDate.localeCompare(right.asOfDate) ||
      left.productCode.localeCompare(right.productCode),
  );
}

function assertContractBar(row: CommodityCarryContractBar): void {
  if (
    !row.productCode ||
    !row.tsCode ||
    !/^\d{8}$/.test(row.tradeDate) ||
    !/^\d{8}$/.test(row.deliveryDate) ||
    row.deliveryDate <= row.tradeDate ||
    !Number.isFinite(row.settle) ||
    row.settle <= 0 ||
    !Number.isFinite(row.volume) ||
    row.volume <= 0 ||
    !Number.isFinite(row.openInterest) ||
    row.openInterest <= 0
  ) {
    throw new Error(`Invalid commodity future bar ${row.tsCode} ${row.tradeDate}.`);
  }
}

function assertDateRange(start: string, end: string): void {
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
    throw new Error('Commodity carry range must be valid YYYYMMDD dates with start <= end.');
  }
}
