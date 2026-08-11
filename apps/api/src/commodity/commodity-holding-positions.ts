import type { TradeDate } from '@jixie/shared';
import { addDays } from '../lib/date.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import { futureHoldings, type FutureHoldingRow } from '../tushare/api.js';
import type { TushareClient } from '../tushare/client.js';
import { COMMODITY_HOLDING_SPECS, type CommodityHoldingProductCode } from './commodity-futures.js';

export const COMMODITY_HOLDING_POSITION_VERSION = 1 as const;
export const COMMODITY_HOLDING_SOURCE = 'tushare_fut_holding';
export const COMMODITY_HOLDING_SELECTION_METHOD = 'max_open_interest_v1';
export const COMMODITY_HOLDING_PAGE_LIMIT = 2_000;

const MAXIMUM_HOLDING_PAGES = 20;
const MAXIMUM_RANKED_ROWS = 60;
const AGGREGATE_BROKER_NAMES = new Set([
  '期货公司',
  '非期货公司',
  '期货公司会员',
  '非期货公司会员',
  '期货公司会员/境外特殊经纪参与者',
  '非期货公司会员/境外特殊非经纪参与者',
]);
const M_DOUBLED_RANKING_DATES = new Set(['20201106']);

export interface CommodityHoldingContractBar {
  productCode: CommodityHoldingProductCode;
  exchange: string;
  tsCode: string;
  tradeDate: string;
  openInterest: number;
  volume: number;
}

export interface CommodityHoldingRepresentative extends CommodityHoldingContractBar {
  sourceSymbol: string;
}

export interface CommodityHoldingFetchRange {
  productCode: CommodityHoldingProductCode;
  exchange: string;
  referenceContract: string;
  sourceSymbol: string;
  startDate: string;
  endDate: string;
  representatives: CommodityHoldingRepresentative[];
}

export interface CommodityHoldingPositionV1 {
  version: typeof COMMODITY_HOLDING_POSITION_VERSION;
  source: typeof COMMODITY_HOLDING_SOURCE;
  productCode: CommodityHoldingProductCode;
  tradeDate: string;
  availableDate: string;
  exchange: string;
  referenceContract: string;
  sourceSymbol: string;
  selectionMethod: typeof COMMODITY_HOLDING_SELECTION_METHOD;
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

export interface CommodityHoldingSyncSummary {
  positions: number;
  missingDates: number;
  fetchRanges: number;
}

export function isAuditedCommodityHoldingCorrectionDate(
  productCode: string,
  tradeDate: string,
): boolean {
  return productCode === 'M' && M_DOUBLED_RANKING_DATES.has(tradeDate);
}

/** Pick one actual contract per product/date without using a vendor continuous symbol. */
export function selectCommodityHoldingRepresentatives(
  rows: CommodityHoldingContractBar[],
): CommodityHoldingRepresentative[] {
  const supportedProducts = new Set<string>(
    COMMODITY_HOLDING_SPECS.map((specification) => specification.productCode),
  );
  const rowsByProductDate = new Map<string, CommodityHoldingContractBar[]>();
  for (const row of rows) {
    if (
      !supportedProducts.has(row.productCode) ||
      !row.exchange ||
      !row.tsCode ||
      !/^\d{8}$/.test(row.tradeDate) ||
      !Number.isFinite(row.openInterest) ||
      row.openInterest <= 0 ||
      !Number.isFinite(row.volume) ||
      row.volume < 0
    ) {
      throw new Error(`Invalid commodity holding contract bar ${row.tsCode} ${row.tradeDate}.`);
    }
    const key = `${row.productCode}|${row.tradeDate}`;
    const bucket = rowsByProductDate.get(key) ?? [];
    if (bucket.some((candidate) => candidate.tsCode === row.tsCode)) {
      throw new Error(`Duplicate commodity holding contract bar ${row.tsCode} ${row.tradeDate}.`);
    }
    bucket.push(row);
    rowsByProductDate.set(key, bucket);
  }

  return [...rowsByProductDate.values()]
    .map((bucket) => {
      const selected = [...bucket].sort(
        (left, right) =>
          right.openInterest - left.openInterest ||
          right.volume - left.volume ||
          left.tsCode.localeCompare(right.tsCode),
      )[0]!;
      return { ...selected, sourceSymbol: selected.tsCode.split('.')[0]!.toUpperCase() };
    })
    .sort(
      (left, right) =>
        left.productCode.localeCompare(right.productCode) ||
        left.tradeDate.localeCompare(right.tradeDate),
    );
}

/** Collapse consecutive representative dates into bounded source requests for one actual contract. */
export function buildCommodityHoldingFetchRanges(
  representatives: CommodityHoldingRepresentative[],
): CommodityHoldingFetchRange[] {
  const ranges: CommodityHoldingFetchRange[] = [];
  for (const representative of [...representatives].sort(
    (left, right) =>
      left.productCode.localeCompare(right.productCode) ||
      left.tradeDate.localeCompare(right.tradeDate),
  )) {
    const previous = ranges.at(-1);
    if (
      previous &&
      previous.productCode === representative.productCode &&
      previous.referenceContract === representative.tsCode
    ) {
      previous.endDate = representative.tradeDate;
      previous.representatives.push(representative);
      continue;
    }
    ranges.push({
      productCode: representative.productCode,
      exchange: representative.exchange,
      referenceContract: representative.tsCode,
      sourceSymbol: representative.sourceSymbol,
      startDate: representative.tradeDate,
      endDate: representative.tradeDate,
      representatives: [representative],
    });
  }
  return ranges;
}

/** Fetch every page for one representative-contract spell and detect ignored offset pagination. */
export async function fetchCommodityHoldingRange(
  client: TushareClient,
  range: CommodityHoldingFetchRange,
): Promise<FutureHoldingRow[]> {
  const rows: FutureHoldingRow[] = [];
  let previousFullPageSignature: string | null = null;
  for (let pageNumber = 0; pageNumber < MAXIMUM_HOLDING_PAGES; pageNumber++) {
    const offset = pageNumber * COMMODITY_HOLDING_PAGE_LIMIT;
    const page = await futureHoldings(client, {
      symbol: range.sourceSymbol,
      start_date: range.startDate as TradeDate,
      end_date: range.endDate as TradeDate,
      limit: COMMODITY_HOLDING_PAGE_LIMIT,
      offset,
    });
    if (page.length > COMMODITY_HOLDING_PAGE_LIMIT) {
      throw new Error(`${range.sourceSymbol} holding response exceeded its requested page size.`);
    }
    if (page.length === COMMODITY_HOLDING_PAGE_LIMIT) {
      const signature = holdingPageSignature(page);
      if (signature === previousFullPageSignature) {
        throw new Error(`${range.sourceSymbol} holding response ignored offset pagination.`);
      }
      previousFullPageSignature = signature;
    }
    rows.push(...page);
    if (page.length < COMMODITY_HOLDING_PAGE_LIMIT) {
      return deduplicateHoldingRows(rows);
    }
  }
  throw new Error(`${range.sourceSymbol} holding response exceeded the pagination safety cap.`);
}

function deduplicateHoldingRows(rows: FutureHoldingRow[]): FutureHoldingRow[] {
  const unique = new Map<string, FutureHoldingRow>();
  for (const row of rows) {
    const key = `${row.trade_date}|${row.symbol}|${row.broker}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, row);
      continue;
    }
    if (holdingRowSignature(existing) !== holdingRowSignature(row)) {
      throw new Error(`Commodity holding pagination returned conflicting duplicate ${key}.`);
    }
  }
  return [...unique.values()];
}

/** Aggregate the exchange's three top-member lists while preserving their subset semantics. */
export function buildCommodityHoldingPositions(
  rows: FutureHoldingRow[],
  representatives: CommodityHoldingRepresentative[],
  openDates: string[],
): CommodityHoldingPositionV1[] {
  const sortedOpenDates = [...new Set(openDates)].sort();
  if (sortedOpenDates.some((date) => !/^\d{8}$/.test(date))) {
    throw new Error('Commodity holding openDates must contain valid YYYYMMDD dates.');
  }
  const representativeByDate = new Map(
    representatives.map((representative) => [representative.tradeDate, representative]),
  );
  if (representativeByDate.size !== representatives.length) {
    throw new Error(
      'Commodity holding representatives contain duplicate dates in one fetch range.',
    );
  }
  const rowsByDate = new Map<string, FutureHoldingRow[]>();
  const sourceRowCountByDate = new Map<string, number>();
  const excludedSummaryRowCountByDate = new Map<string, number>();
  const identities = new Set<string>();
  for (const row of rows) {
    if (!/^\d{8}$/.test(row.trade_date)) {
      throw new Error(`Commodity holding source returned invalid date ${row.trade_date}.`);
    }
    const representative = representativeByDate.get(row.trade_date);
    if (!representative) {
      continue;
    }
    if (row.symbol.trim().toUpperCase() !== representative.sourceSymbol || !row.broker?.trim()) {
      throw new Error(
        `Commodity holding source returned invalid identity ${row.symbol} ${row.trade_date}.`,
      );
    }
    const normalizedRow = normalizeHoldingRow(row, representative.productCode);
    validateHoldingRow(normalizedRow);
    const identity = `${row.trade_date}|${row.broker.trim()}`;
    if (identities.has(identity)) {
      throw new Error(`Commodity holding source returned duplicate member ${identity}.`);
    }
    identities.add(identity);
    sourceRowCountByDate.set(row.trade_date, (sourceRowCountByDate.get(row.trade_date) ?? 0) + 1);
    if (AGGREGATE_BROKER_NAMES.has(row.broker.trim())) {
      excludedSummaryRowCountByDate.set(
        row.trade_date,
        (excludedSummaryRowCountByDate.get(row.trade_date) ?? 0) + 1,
      );
      continue;
    }
    const bucket = rowsByDate.get(row.trade_date) ?? [];
    bucket.push(normalizedRow);
    rowsByDate.set(row.trade_date, bucket);
  }

  const points: CommodityHoldingPositionV1[] = [];
  for (const representative of representatives) {
    const dateRows = rowsByDate.get(representative.tradeDate) ?? [];
    if (dateRows.length === 0) {
      continue;
    }
    if (dateRows.length > MAXIMUM_RANKED_ROWS) {
      throw new Error(
        `Commodity holding ${representative.sourceSymbol} ${representative.tradeDate} has more than ${MAXIMUM_RANKED_ROWS} ranked members.`,
      );
    }
    const volume = positiveValues(dateRows, 'vol');
    const long = positiveValues(dateRows, 'long_hld');
    const short = positiveValues(dateRows, 'short_hld');
    if (volume.length === 0 || long.length === 0 || short.length === 0) {
      // Some source dates contain only a subset of the three rankings. The date is not a valid
      // comparable position aggregate, so preserve it as missing rather than manufacturing zeros.
      continue;
    }
    if (volume.length > 20 || long.length > 20 || short.length > 20) {
      throw new Error(
        `Commodity holding ${representative.sourceSymbol} ${representative.tradeDate} has invalid ranked-list sizes.`,
      );
    }
    const rankedLongHolding = sum(long);
    const rankedShortHolding = sum(short);
    if (
      rankedLongHolding > representative.openInterest ||
      rankedShortHolding > representative.openInterest
    ) {
      throw new Error(
        `Commodity holding ${representative.sourceSymbol} ${representative.tradeDate} exceeds contract open interest.`,
      );
    }
    const availableDate = sortedOpenDates.find((date) => date > representative.tradeDate);
    if (!availableDate) {
      throw new Error(
        `No next SSE trading day is available after commodity holding date ${representative.tradeDate}.`,
      );
    }
    points.push({
      version: COMMODITY_HOLDING_POSITION_VERSION,
      source: COMMODITY_HOLDING_SOURCE,
      productCode: representative.productCode,
      tradeDate: representative.tradeDate,
      availableDate,
      exchange: representative.exchange,
      referenceContract: representative.tsCode,
      sourceSymbol: representative.sourceSymbol,
      selectionMethod: COMMODITY_HOLDING_SELECTION_METHOD,
      contractOpenInterest: representative.openInterest,
      contractVolume: representative.volume,
      rankedVolume: sum(volume),
      rankedVolumeChange: completeChangeSum(dateRows, 'vol', 'vol_chg'),
      rankedLongHolding,
      rankedLongChange: completeChangeSum(dateRows, 'long_hld', 'long_chg'),
      rankedShortHolding,
      rankedShortChange: completeChangeSum(dateRows, 'short_hld', 'short_chg'),
      topFiveLongHolding: sum([...long].sort(descending).slice(0, 5)),
      topFiveShortHolding: sum([...short].sort(descending).slice(0, 5)),
      volumeMemberCount: volume.length,
      longMemberCount: long.length,
      shortMemberCount: short.length,
      sourceRowCount: sourceRowCountByDate.get(representative.tradeDate) ?? dateRows.length,
      excludedSummaryRowCount: excludedSummaryRowCountByDate.get(representative.tradeDate) ?? 0,
      sourceCorrectionApplied: isAuditedCommodityHoldingCorrectionDate(
        representative.productCode,
        representative.tradeDate,
      ),
    });
  }
  return points.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

/** Sync daily aggregates for AU/CU/M; SC is deliberately excluded until Tushare returns INE rows. */
export async function syncCommodityHoldingPositions(
  client: TushareClient,
  startDate: string,
  endDate: string,
  database: Prisma = prisma,
  onLog: (line: string) => void = console.log,
): Promise<CommodityHoldingSyncSummary> {
  assertDateRange(startDate, endDate);
  const representatives = await loadCommodityHoldingRepresentatives(startDate, endDate, database);
  const fetchRanges = buildCommodityHoldingFetchRanges(representatives);
  const calendarRows = await database.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gt: startDate, lte: addDays(endDate, 14) },
    },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const openDates = calendarRows.map((row) => row.calDate);
  let positions = 0;
  let missingDates = 0;

  for (const [index, range] of fetchRanges.entries()) {
    const rows = await fetchCommodityHoldingRange(client, range);
    const points = buildCommodityHoldingPositions(rows, range.representatives, openDates);
    missingDates += range.representatives.length - points.length;
    const retrievedAt = new Date();
    await database.$transaction([
      database.commodityHoldingPosition.deleteMany({
        where: {
          productCode: range.productCode,
          tradeDate: { in: range.representatives.map((item) => item.tradeDate) },
        },
      }),
      ...(points.length > 0
        ? [
            database.commodityHoldingPosition.createMany({
              data: points.map((point) => ({ ...point, retrievedAt })),
            }),
          ]
        : []),
    ]);
    if (points.length > 0) {
      positions += points.length;
    }
    if ((index + 1) % 20 === 0 || index + 1 === fetchRanges.length) {
      onLog(
        `Commodity holding positions: ${index + 1}/${fetchRanges.length} contract ranges, ${positions} dates, ${missingDates} source-empty dates`,
      );
    }
  }
  return { positions, missingDates, fetchRanges: fetchRanges.length };
}

export async function loadCommodityHoldingRepresentatives(
  startDate: string,
  endDate: string,
  database: Prisma,
): Promise<CommodityHoldingRepresentative[]> {
  const productCodes = COMMODITY_HOLDING_SPECS.map((specification) => specification.productCode);
  const contracts = await database.futureContract.findMany({
    where: {
      productCode: { in: productCodes },
      listDate: { lte: endDate },
      delistDate: { gte: startDate },
    },
    select: { tsCode: true, productCode: true, exchange: true },
  });
  if (contracts.length === 0) {
    throw new Error('Commodity holding sync requires commodity FutureContract metadata.');
  }
  const contractByCode = new Map(contracts.map((contract) => [contract.tsCode, contract]));
  const bars = await database.futureDaily.findMany({
    where: {
      tsCode: { in: contracts.map((contract) => contract.tsCode) },
      tradeDate: { gte: startDate, lte: endDate },
      openInterest: { gt: 0 },
      volume: { not: null },
    },
    select: { tsCode: true, tradeDate: true, openInterest: true, volume: true },
  });
  const normalized = bars.flatMap((bar): CommodityHoldingContractBar[] => {
    const contract = contractByCode.get(bar.tsCode);
    if (!contract || bar.openInterest == null || bar.volume == null) {
      return [];
    }
    return [
      {
        productCode: contract.productCode as CommodityHoldingProductCode,
        exchange: contract.exchange,
        tsCode: bar.tsCode,
        tradeDate: bar.tradeDate,
        openInterest: bar.openInterest,
        volume: bar.volume,
      },
    ];
  });
  if (normalized.length === 0) {
    throw new Error('Commodity holding sync requires commodity FutureDaily open interest.');
  }
  return selectCommodityHoldingRepresentatives(normalized);
}

function validateHoldingRow(row: FutureHoldingRow): void {
  for (const field of ['vol', 'long_hld', 'short_hld'] as const) {
    const value = row[field];
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Commodity holding ${row.symbol} ${row.trade_date} has invalid ${field}.`);
    }
  }
  for (const field of ['vol_chg', 'long_chg', 'short_chg'] as const) {
    const value = row[field];
    if (value != null && !Number.isFinite(value)) {
      throw new Error(`Commodity holding ${row.symbol} ${row.trade_date} has invalid ${field}.`);
    }
  }
}

function normalizeHoldingRow(
  row: FutureHoldingRow,
  productCode: CommodityHoldingProductCode,
): FutureHoldingRow {
  if (!isAuditedCommodityHoldingCorrectionDate(productCode, row.trade_date)) {
    return row;
  }
  const corrected = { ...row };
  for (const field of [
    'vol',
    'vol_chg',
    'long_hld',
    'long_chg',
    'short_hld',
    'short_chg',
  ] as const) {
    const value = row[field];
    if (value != null) {
      if (!Number.isInteger(value) || value % 2 !== 0) {
        throw new Error(
          `Audited commodity holding correction ${productCode} ${row.trade_date} has non-even ${field}.`,
        );
      }
      corrected[field] = value / 2;
    }
  }
  return corrected;
}

function positiveValues(
  rows: FutureHoldingRow[],
  field: 'vol' | 'long_hld' | 'short_hld',
): number[] {
  return rows.flatMap((row) => {
    const value = row[field];
    return value != null && value > 0 ? [value] : [];
  });
}

function completeChangeSum(
  rows: FutureHoldingRow[],
  levelField: 'vol' | 'long_hld' | 'short_hld',
  changeField: 'vol_chg' | 'long_chg' | 'short_chg',
): number | null {
  const rankedRows = rows.filter((row) => row[levelField] != null && row[levelField]! > 0);
  return rankedRows.every((row) => row[changeField] != null)
    ? sum(rankedRows.map((row) => row[changeField]!))
    : null;
}

function holdingPageSignature(rows: FutureHoldingRow[]): string {
  const first = rows[0];
  const last = rows.at(-1);
  return `${first?.trade_date}|${first?.symbol}|${first?.broker}|${last?.trade_date}|${last?.symbol}|${last?.broker}|${rows.length}`;
}

function holdingRowSignature(row: FutureHoldingRow): string {
  return [
    row.trade_date,
    row.symbol,
    row.broker,
    row.vol,
    row.vol_chg,
    row.long_hld,
    row.long_chg,
    row.short_hld,
    row.short_chg,
    row.exchange,
  ].join('|');
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function descending(left: number, right: number): number {
  return right - left;
}

function assertDateRange(startDate: string, endDate: string): void {
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('Commodity holding range must be valid YYYYMMDD dates with start <= end.');
  }
}
