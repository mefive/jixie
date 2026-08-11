import type { TradeDate } from '@jixie/shared';
import { addDays } from '../lib/date.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import { futureMapping, type FutureMappingRow } from '../tushare/api.js';
import type { TushareClient } from '../tushare/client.js';
import {
  COMMODITY_MAIN_CONTRACT_SPECS,
  type CommodityFutureProductCode,
} from './commodity-futures.js';

export const COMMODITY_CONTINUOUS_RETURN_VERSION = 1 as const;
export const COMMODITY_CONTINUOUS_RETURN_SOURCE = 'tushare_fut_mapping+fut_daily';
export const COMMODITY_CONTINUOUS_RETURN_METHOD = 'tushare_main_contract_mapping_v1';

const CONTEXT_CALENDAR_DAYS = 21;
const TUSHARE_MAPPING_ROW_LIMIT = 2_000;
const DECOMPOSITION_TOLERANCE = 1e-12;

export interface CommodityMainContractMapping {
  productCode: CommodityFutureProductCode;
  continuousCode: string;
  tradeDate: string;
  mappedContract: string;
}

export interface CommodityContinuousSettlementBar {
  tsCode: string;
  tradeDate: string;
  settle: number;
}

export interface CommodityContinuousReturnPointV1 {
  version: typeof COMMODITY_CONTINUOUS_RETURN_VERSION;
  source: typeof COMMODITY_CONTINUOUS_RETURN_SOURCE;
  productCode: CommodityFutureProductCode;
  tradeDate: string;
  availableDate: string;
  continuousCode: string;
  mappingMethod: typeof COMMODITY_CONTINUOUS_RETURN_METHOD;
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
}

export interface CommodityContinuousReturnSyncSummary {
  mappings: number;
  returns: number;
  rollDays: number;
}

/** Fetch Tushare's main-contract (not L-suffixed nearby-continuous) mapping in bounded years. */
export async function syncCommodityMainContractMappings(
  client: TushareClient,
  startDate: string,
  endDate: string,
  database: Prisma = prisma,
  onLog: (line: string) => void = console.log,
): Promise<number> {
  assertDateRange(startDate, endDate);
  const batches: {
    continuousCode: string;
    startDate: string;
    endDate: string;
    rows: FutureMappingRow[];
  }[] = [];
  for (const specification of COMMODITY_MAIN_CONTRACT_SPECS) {
    const productStart = startDate > specification.startDate ? startDate : specification.startDate;
    if (productStart > endDate) {
      continue;
    }
    for (const range of yearlyRanges(productStart, endDate)) {
      const rows = await futureMapping(client, {
        ts_code: specification.continuousCode,
        start_date: range.startDate as TradeDate,
        end_date: range.endDate as TradeDate,
      });
      if (rows.length >= TUSHARE_MAPPING_ROW_LIMIT) {
        throw new Error(
          `${specification.continuousCode} mapping reached the ${TUSHARE_MAPPING_ROW_LIMIT}-row source limit.`,
        );
      }
      validateMappingBatch(specification, range, rows);
      batches.push({
        continuousCode: specification.continuousCode,
        startDate: range.startDate,
        endDate: range.endDate,
        rows,
      });
    }
  }

  const unique = new Map<string, FutureMappingRow>();
  for (const batch of batches) {
    for (const row of batch.rows) {
      const key = `${row.ts_code}|${row.trade_date}`;
      const existing = unique.get(key);
      if (existing && existing.mapping_ts_code !== row.mapping_ts_code) {
        throw new Error(`Conflicting commodity main mapping ${key}.`);
      }
      unique.set(key, row);
    }
  }
  await database.$transaction([
    ...COMMODITY_MAIN_CONTRACT_SPECS.map((specification) =>
      database.futureMapping.deleteMany({
        where: {
          continuousCode: specification.continuousCode,
          tradeDate: { gte: startDate, lte: endDate },
        },
      }),
    ),
    database.futureMapping.createMany({
      data: [...unique.values()].map((row) => ({
        continuousCode: row.ts_code,
        tradeDate: row.trade_date,
        mappedTsCode: row.mapping_ts_code,
      })),
    }),
  ]);
  onLog(`Commodity main mappings: ${unique.size} product-days`);
  return unique.size;
}

/**
 * Build a return chain with an explicit roll decomposition:
 * mappedLogReturn = continuousLogReturn + rollGapLogReturn.
 * continuousLogReturn always compares the current mapped contract on both interval endpoints.
 */
export function buildCommodityContinuousReturns(
  mappings: CommodityMainContractMapping[],
  bars: CommodityContinuousSettlementBar[],
  openDates: string[],
): CommodityContinuousReturnPointV1[] {
  const specificationByContinuousCode = new Map<
    string,
    (typeof COMMODITY_MAIN_CONTRACT_SPECS)[number]
  >(
    COMMODITY_MAIN_CONTRACT_SPECS.map((specification) => [
      specification.continuousCode,
      specification,
    ]),
  );
  const sortedOpenDates = [...new Set(openDates)].sort();
  if (sortedOpenDates.some((date) => !validDate(date))) {
    throw new Error('Commodity continuous-return openDates must contain valid YYYYMMDD dates.');
  }

  const mappingsByProduct = new Map<CommodityFutureProductCode, CommodityMainContractMapping[]>();
  const mappingKeys = new Set<string>();
  for (const mapping of mappings) {
    const specification = specificationByContinuousCode.get(mapping.continuousCode);
    if (
      !specification ||
      specification.productCode !== mapping.productCode ||
      !validDate(mapping.tradeDate) ||
      !mapping.mappedContract.toUpperCase().startsWith(mapping.productCode)
    ) {
      throw new Error(
        `Invalid commodity main mapping ${mapping.continuousCode} ${mapping.tradeDate} ${mapping.mappedContract}.`,
      );
    }
    const key = `${mapping.productCode}|${mapping.tradeDate}`;
    if (mappingKeys.has(key)) {
      throw new Error(`Duplicate commodity main mapping ${key}.`);
    }
    mappingKeys.add(key);
    const bucket = mappingsByProduct.get(mapping.productCode) ?? [];
    bucket.push(mapping);
    mappingsByProduct.set(mapping.productCode, bucket);
  }

  const barByKey = new Map<string, CommodityContinuousSettlementBar>();
  for (const bar of bars) {
    if (
      !bar.tsCode ||
      !validDate(bar.tradeDate) ||
      !Number.isFinite(bar.settle) ||
      bar.settle <= 0
    ) {
      throw new Error(`Invalid commodity settlement ${bar.tsCode} ${bar.tradeDate}.`);
    }
    const key = `${bar.tsCode}|${bar.tradeDate}`;
    if (barByKey.has(key)) {
      throw new Error(`Duplicate commodity settlement ${key}.`);
    }
    barByKey.set(key, bar);
  }

  const points: CommodityContinuousReturnPointV1[] = [];
  for (const [productCode, productMappings] of mappingsByProduct) {
    productMappings.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
    for (let index = 1; index < productMappings.length; index++) {
      const previous = productMappings[index - 1]!;
      const current = productMappings[index]!;
      const settlement = barByKey.get(`${current.mappedContract}|${current.tradeDate}`)?.settle;
      const sameContractPreviousSettlement = barByKey.get(
        `${current.mappedContract}|${previous.tradeDate}`,
      )?.settle;
      const previousMappedSettlement = barByKey.get(
        `${previous.mappedContract}|${previous.tradeDate}`,
      )?.settle;
      if (
        settlement == null ||
        sameContractPreviousSettlement == null ||
        previousMappedSettlement == null
      ) {
        continue;
      }
      const availableDate = sortedOpenDates.find((date) => date > current.tradeDate);
      if (!availableDate) {
        throw new Error(
          `No next SSE trading day is available after commodity return date ${current.tradeDate}.`,
        );
      }
      const continuousLogReturn = Math.log(settlement / sameContractPreviousSettlement);
      const mappedLogReturn = Math.log(settlement / previousMappedSettlement);
      const rollGapLogReturn = Math.log(sameContractPreviousSettlement / previousMappedSettlement);
      if (
        Math.abs(mappedLogReturn - continuousLogReturn - rollGapLogReturn) > DECOMPOSITION_TOLERANCE
      ) {
        throw new Error(
          `Commodity roll decomposition failed for ${productCode} ${current.tradeDate}.`,
        );
      }
      points.push({
        version: COMMODITY_CONTINUOUS_RETURN_VERSION,
        source: COMMODITY_CONTINUOUS_RETURN_SOURCE,
        productCode,
        tradeDate: current.tradeDate,
        availableDate,
        continuousCode: current.continuousCode,
        mappingMethod: COMMODITY_CONTINUOUS_RETURN_METHOD,
        mappedContract: current.mappedContract,
        previousTradeDate: previous.tradeDate,
        previousMappedContract: previous.mappedContract,
        settlement,
        sameContractPreviousSettlement,
        previousMappedSettlement,
        continuousReturn: Math.expm1(continuousLogReturn),
        continuousLogReturn,
        mappedLogReturn,
        rollGapLogReturn,
        rollYieldProxy: -rollGapLogReturn,
        mappingChanged: current.mappedContract !== previous.mappedContract,
      });
    }
  }
  return points.sort(
    (left, right) =>
      left.tradeDate.localeCompare(right.tradeDate) ||
      left.productCode.localeCompare(right.productCode),
  );
}

export async function computeCommodityContinuousReturns(
  startDate: string,
  endDate: string,
  database: Prisma = prisma,
): Promise<CommodityContinuousReturnPointV1[]> {
  assertDateRange(startDate, endDate);
  const contextStart = addDays(startDate, -CONTEXT_CALENDAR_DAYS);
  const specificationByCode = new Map<string, (typeof COMMODITY_MAIN_CONTRACT_SPECS)[number]>(
    COMMODITY_MAIN_CONTRACT_SPECS.map((specification) => [
      specification.continuousCode,
      specification,
    ]),
  );
  const mappingRows = await database.futureMapping.findMany({
    where: {
      continuousCode: { in: [...specificationByCode.keys()] },
      tradeDate: { gte: contextStart, lte: endDate },
    },
    orderBy: [{ continuousCode: 'asc' }, { tradeDate: 'asc' }],
  });
  const mappings = mappingRows.flatMap((row): CommodityMainContractMapping[] => {
    const specification = specificationByCode.get(row.continuousCode);
    return specification
      ? [
          {
            productCode: specification.productCode,
            continuousCode: row.continuousCode,
            tradeDate: row.tradeDate,
            mappedContract: row.mappedTsCode,
          },
        ]
      : [];
  });
  const mappedContracts = [...new Set(mappings.map((mapping) => mapping.mappedContract))];
  const [barRows, calendarRows] = await Promise.all([
    database.futureDaily.findMany({
      where: {
        tsCode: { in: mappedContracts },
        tradeDate: { gte: contextStart, lte: endDate },
        settle: { not: null },
      },
      select: { tsCode: true, tradeDate: true, settle: true },
    }),
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gt: contextStart, lte: addDays(endDate, 14) },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
  ]);
  const points = buildCommodityContinuousReturns(
    mappings,
    barRows.flatMap((row): CommodityContinuousSettlementBar[] =>
      row.settle == null ? [] : [{ ...row, settle: row.settle }],
    ),
    calendarRows.map((row) => row.calDate),
  );
  return points.filter((point) => point.tradeDate >= startDate && point.tradeDate <= endDate);
}

export async function rebuildCommodityContinuousReturns(
  startDate: string,
  endDate: string,
  database: Prisma = prisma,
): Promise<CommodityContinuousReturnSyncSummary> {
  const points = await computeCommodityContinuousReturns(startDate, endDate, database);
  const retrievedAt = new Date();
  await database.$transaction([
    database.commodityContinuousReturn.deleteMany({
      where: { tradeDate: { gte: startDate, lte: endDate } },
    }),
    database.commodityContinuousReturn.createMany({
      data: points.map((point) => ({ ...point, retrievedAt })),
    }),
  ]);
  return {
    mappings: 0,
    returns: points.length,
    rollDays: points.filter((point) => point.mappingChanged).length,
  };
}

export async function syncCommodityContinuousReturns(
  client: TushareClient,
  startDate: string,
  endDate: string,
  database: Prisma = prisma,
  onLog: (line: string) => void = console.log,
): Promise<CommodityContinuousReturnSyncSummary> {
  assertDateRange(startDate, endDate);
  const contextStart = addDays(startDate, -CONTEXT_CALENDAR_DAYS);
  const mappings = await syncCommodityMainContractMappings(
    client,
    contextStart,
    endDate,
    database,
    onLog,
  );
  const summary = await rebuildCommodityContinuousReturns(startDate, endDate, database);
  const result = { ...summary, mappings };
  onLog(
    `Commodity continuous returns: ${result.returns} dates, ${result.rollDays} mapped roll days`,
  );
  return result;
}

function validateMappingBatch(
  specification: (typeof COMMODITY_MAIN_CONTRACT_SPECS)[number],
  range: { startDate: string; endDate: string },
  rows: FutureMappingRow[],
): void {
  const identities = new Set<string>();
  for (const row of rows) {
    if (
      row.ts_code !== specification.continuousCode ||
      row.trade_date < range.startDate ||
      row.trade_date > range.endDate ||
      !validDate(row.trade_date) ||
      !row.mapping_ts_code?.toUpperCase().startsWith(specification.productCode)
    ) {
      throw new Error(
        `Invalid ${specification.continuousCode} source mapping ${row.trade_date} ${row.mapping_ts_code}.`,
      );
    }
    if (identities.has(row.trade_date)) {
      throw new Error(`Duplicate ${specification.continuousCode} mapping ${row.trade_date}.`);
    }
    identities.add(row.trade_date);
  }
}

function yearlyRanges(startDate: string, endDate: string) {
  const ranges: { startDate: string; endDate: string }[] = [];
  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    ranges.push({
      startDate: year === firstYear ? startDate : `${year}0101`,
      endDate: year === lastYear ? endDate : `${year}1231`,
    });
  }
  return ranges;
}

function assertDateRange(startDate: string, endDate: string): void {
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    throw new Error('Commodity continuous-return range must be YYYYMMDD with start <= end.');
  }
}

function validDate(value: string): boolean {
  return /^\d{8}$/.test(value);
}
