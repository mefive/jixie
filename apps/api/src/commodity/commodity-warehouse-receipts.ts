import type { TradeDate } from '@jixie/shared';
import { addDays, day } from '../lib/date.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import { futureWarehouseReceipts, type FutureWarehouseReceiptRow } from '../tushare/api.js';
import type { TushareClient } from '../tushare/client.js';
import { COMMODITY_FUTURE_SPECS, type CommodityFutureProductCode } from './commodity-futures.js';

export const COMMODITY_WAREHOUSE_RECEIPT_VERSION = 1 as const;
export const COMMODITY_WAREHOUSE_RECEIPT_PAGE_LIMIT = 1_000;

const SUBTOTAL_WAREHOUSE_PATTERN = /(合计|总计|小计)/;
const MAXIMUM_WAREHOUSE_RECEIPT_PAGES = 100;

export interface CommodityWarehouseReceiptPointV1 {
  version: typeof COMMODITY_WAREHOUSE_RECEIPT_VERSION;
  productCode: CommodityFutureProductCode;
  tradeDate: string;
  availableDate: string;
  sourceName: string;
  sourceUnit: string;
  unit: string;
  unitCorrectionApplied: boolean;
  volume: number;
  volumeChange: number | null;
  sourceRowCount: number;
}

export interface CommodityWarehouseReceiptProductSpec {
  productCode: CommodityFutureProductCode;
  sourceName: string;
  units: readonly string[];
}

interface CleanWarehouseReceiptRow {
  row: FutureWarehouseReceiptRow;
  normalizedUnit: string;
  unitCorrectionApplied: boolean;
}

// These audited AU dates are labelled as tonnes while adjacent unchanged levels are kg. Keep the
// correction registry exact and auditable instead of inferring units from the product or volume.
const AU_KILOGRAM_MISLABEL_DATES = new Set([
  '20200410',
  '20200605',
  '20221221',
  '20221222',
  '20221223',
  '20221226',
  '20221227',
  '20221228',
  '20221229',
  '20221230',
  '20230103',
  '20230104',
  '20230106',
  '20230109',
  '20250806',
  '20250807',
  '20250808',
]);

/** Aggregates physical warehouse rows within one product and date. Absolute levels remain in the
 * exchange's original product-specific unit and must never be ranked across products directly. */
export function buildCommodityWarehouseReceiptDaily(
  rows: FutureWarehouseReceiptRow[],
  product: CommodityWarehouseReceiptProductSpec,
  openDates: string[],
  start: string,
  end: string,
): CommodityWarehouseReceiptPointV1[] {
  assertDateRange(start, end);
  const sortedOpenDates = [...new Set(openDates)].sort();
  if (sortedOpenDates.some((date) => !/^\d{8}$/.test(date))) {
    throw new Error('Commodity warehouse-receipt openDates must contain valid YYYYMMDD dates.');
  }

  for (const row of rows) {
    if (!/^\d{8}$/.test(row.trade_date) || row.trade_date < start || row.trade_date > end) {
      throw new Error(`Commodity warehouse receipt returned out-of-range date ${row.trade_date}.`);
    }
  }
  const namedRows = rows.filter((row) => row.fut_name === product.sourceName);
  if (rows.length > 0 && namedRows.length === 0) {
    throw new Error(
      `Commodity warehouse receipt ${product.productCode} omitted source name ${product.sourceName}.`,
    );
  }

  const cleanByDateUnit = new Map<string, CleanWarehouseReceiptRow[]>();
  const namedDates = new Set<string>();
  const identities = new Set<string>();
  for (const row of namedRows) {
    namedDates.add(row.trade_date);
    if (row.warehouse && SUBTOTAL_WAREHOUSE_PATTERN.test(row.warehouse)) {
      continue;
    }
    const unitCorrectionApplied =
      product.productCode === 'AU' &&
      row.unit === '吨' &&
      AU_KILOGRAM_MISLABEL_DATES.has(row.trade_date);
    const normalizedUnit = unitCorrectionApplied ? '千克' : row.unit;
    if (
      !row.warehouse?.trim() ||
      !normalizedUnit ||
      !product.units.includes(normalizedUnit) ||
      !Number.isFinite(row.vol) ||
      row.vol! < 0 ||
      (row.vol_chg != null && !Number.isFinite(row.vol_chg))
    ) {
      throw new Error(
        `Invalid commodity warehouse receipt ${product.productCode} ${row.trade_date}.`,
      );
    }
    const identity = warehouseReceiptIdentity(row);
    if (identities.has(identity)) {
      throw new Error(
        `Duplicate commodity warehouse receipt ${product.productCode} ${row.trade_date}.`,
      );
    }
    identities.add(identity);
    const bucketKey = `${row.trade_date}:${normalizedUnit}`;
    const bucket = cleanByDateUnit.get(bucketKey) ?? [];
    bucket.push({ row, normalizedUnit, unitCorrectionApplied });
    cleanByDateUnit.set(bucketKey, bucket);
  }
  for (const tradeDate of namedDates) {
    if (![...cleanByDateUnit.keys()].some((key) => key.startsWith(`${tradeDate}:`))) {
      throw new Error(
        `Commodity warehouse receipt ${product.productCode} ${tradeDate} has only subtotal rows.`,
      );
    }
  }

  return [...cleanByDateUnit.values()]
    .map((dateRows) => {
      const tradeDate = dateRows[0]!.row.trade_date;
      const unit = dateRows[0]!.normalizedUnit;
      const availableDate = sortedOpenDates.find((date) => date > tradeDate);
      if (!availableDate) {
        throw new Error(
          `No next SSE trading day is available after warehouse-receipt date ${tradeDate}.`,
        );
      }
      const sourceUnits = new Set(dateRows.map(({ row }) => row.unit));
      if (sourceUnits.size !== 1) {
        throw new Error(
          `Commodity warehouse receipt ${product.productCode} ${tradeDate} mixed physical-row units.`,
        );
      }
      const hasCompleteChange = dateRows.every(({ row }) => row.vol_chg != null);
      return {
        version: COMMODITY_WAREHOUSE_RECEIPT_VERSION,
        productCode: product.productCode,
        tradeDate,
        availableDate,
        sourceName: product.sourceName,
        sourceUnit: dateRows[0]!.row.unit!,
        unit,
        unitCorrectionApplied: dateRows.some(({ unitCorrectionApplied }) => unitCorrectionApplied),
        volume: dateRows.reduce((sum, { row }) => sum + row.vol!, 0),
        volumeChange: hasCompleteChange
          ? dateRows.reduce((sum, { row }) => sum + row.vol_chg!, 0)
          : null,
        sourceRowCount: dateRows.length,
      };
    })
    .sort(
      (left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) || left.unit.localeCompare(right.unit),
    );
}

/** Fetches all pages for one product slice and fails if the provider ignores offset pagination. */
export async function fetchCommodityWarehouseReceiptRange(
  client: TushareClient,
  productCode: CommodityFutureProductCode,
  start: TradeDate,
  end: TradeDate,
): Promise<FutureWarehouseReceiptRow[]> {
  assertDateRange(start, end);
  const rows: FutureWarehouseReceiptRow[] = [];
  let previousFullPageSignature: string | null = null;

  for (let pageNumber = 0; pageNumber < MAXIMUM_WAREHOUSE_RECEIPT_PAGES; pageNumber++) {
    const offset = pageNumber * COMMODITY_WAREHOUSE_RECEIPT_PAGE_LIMIT;
    const page = await futureWarehouseReceipts(client, {
      symbol: productCode,
      start_date: start,
      end_date: end,
      limit: COMMODITY_WAREHOUSE_RECEIPT_PAGE_LIMIT,
      offset,
    });
    if (page.length > COMMODITY_WAREHOUSE_RECEIPT_PAGE_LIMIT) {
      throw new Error(
        `Commodity warehouse receipt ${productCode} exceeded its requested page size.`,
      );
    }
    if (page.length === COMMODITY_WAREHOUSE_RECEIPT_PAGE_LIMIT) {
      const signature = pageSignature(page);
      if (signature === previousFullPageSignature) {
        throw new Error(`Commodity warehouse receipt ${productCode} ignored offset pagination.`);
      }
      previousFullPageSignature = signature;
    }
    rows.push(...page);
    if (page.length < COMMODITY_WAREHOUSE_RECEIPT_PAGE_LIMIT) {
      return rows;
    }
  }
  throw new Error(`Commodity warehouse receipt ${productCode} exceeded the pagination safety cap.`);
}

/** Synchronizes research-only daily warehouse-receipt aggregates in bounded monthly slices. */
export async function syncCommodityWarehouseReceipts(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
  database: Prisma = prisma,
  onLog: (line: string) => void = console.log,
): Promise<number> {
  assertDateRange(start, end);
  const calendar = await database.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gt: start, lte: addDays(end, 14) },
    },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const openDates = calendar.map((row) => row.calDate);
  let total = 0;

  for (const specification of COMMODITY_FUTURE_SPECS) {
    const product: CommodityWarehouseReceiptProductSpec = {
      productCode: specification.productCode,
      sourceName: specification.warehouseReceipt.sourceName,
      units: specification.warehouseReceipt.units,
    };
    for (const range of monthlyRanges(start, end)) {
      const rows = await fetchCommodityWarehouseReceiptRange(
        client,
        product.productCode,
        range.start,
        range.end,
      );
      if (rows.length === 0) {
        const existing = await database.commodityWarehouseReceipt.count({
          where: {
            productCode: product.productCode,
            tradeDate: { gte: range.start, lte: range.end },
          },
        });
        if (existing > 0) {
          onLog(
            `Commodity warehouse receipt ${product.productCode} ${range.start}..${range.end}: upstream empty, preserving ${existing} rows`,
          );
        }
        continue;
      }
      const points = buildCommodityWarehouseReceiptDaily(
        rows,
        product,
        openDates,
        range.start,
        range.end,
      );
      const retrievedAt = new Date();
      await database.$transaction([
        database.commodityWarehouseReceipt.deleteMany({
          where: {
            productCode: product.productCode,
            tradeDate: { gte: range.start, lte: range.end },
          },
        }),
        database.commodityWarehouseReceipt.createMany({
          data: points.map((point) => ({
            productCode: point.productCode,
            tradeDate: point.tradeDate,
            availableDate: point.availableDate,
            sourceName: point.sourceName,
            sourceUnit: point.sourceUnit,
            unit: point.unit,
            unitCorrectionApplied: point.unitCorrectionApplied,
            volume: point.volume,
            volumeChange: point.volumeChange,
            sourceRowCount: point.sourceRowCount,
            retrievedAt,
          })),
        }),
      ]);
      total += points.length;
      onLog(
        `Commodity warehouse receipt ${product.productCode} ${range.start}..${range.end}: ${points.length} daily aggregates`,
      );
    }
  }
  return total;
}

function monthlyRanges(
  start: TradeDate,
  end: TradeDate,
): Array<{ start: TradeDate; end: TradeDate }> {
  const ranges: Array<{ start: TradeDate; end: TradeDate }> = [];
  let rangeStart = start;

  while (rangeStart <= end) {
    const calendarMonthEnd = day(rangeStart).endOf('month').format('YYYYMMDD') as TradeDate;
    const rangeEnd = (calendarMonthEnd < end ? calendarMonthEnd : end) as TradeDate;
    ranges.push({ start: rangeStart, end: rangeEnd });
    rangeStart = addDays(rangeEnd, 1) as TradeDate;
  }
  return ranges;
}

function warehouseReceiptIdentity(row: FutureWarehouseReceiptRow): string {
  return [
    row.trade_date,
    row.symbol,
    row.fut_name,
    row.warehouse,
    row.wh_id,
    row.area,
    row.year,
    row.grade,
    row.brand,
    row.place,
    row.pd,
    row.is_ct,
    row.unit,
    row.exchange,
  ].join('|');
}

function pageSignature(rows: FutureWarehouseReceiptRow[]): string {
  return `${rows.length}:${warehouseReceiptIdentity(rows[0]!)}:${warehouseReceiptIdentity(rows.at(-1)!)}`;
}

function assertDateRange(start: string, end: string): void {
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
    throw new Error(
      'Commodity warehouse-receipt range must be valid YYYYMMDD dates with start <= end.',
    );
  }
}
