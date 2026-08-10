import { addDays } from '../lib/date.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import { COMMODITY_FUTURE_SPECS, type CommodityFutureProductCode } from './commodity-futures.js';
import { isAuditedAuKilogramMislabelDate } from './commodity-warehouse-receipts.js';

export type CommodityWarehouseReceiptQualityStatus = 'pass' | 'warn' | 'error';

export interface CommodityWarehouseReceiptQualityRow {
  productCode: string;
  tradeDate: string;
  availableDate: string;
  sourceName: string;
  sourceUnit: string | null;
  unit: string;
  unitCorrectionApplied: boolean;
  volume: number;
  volumeChange: number | null;
  sourceRowCount: number;
}

export interface CommodityWarehouseReceiptProductQuality {
  productCode: CommodityFutureProductCode;
  rows: number;
  latestTradeDate: string | null;
  latestAvailableDate: string | null;
  lagTradingDays: number | null;
  units: string[];
}

export interface CommodityWarehouseReceiptQualitySummary {
  startDate: string;
  endDate: string;
  rows: number;
  invalidRows: number;
  maximumLagTradingDays: number;
  status: CommodityWarehouseReceiptQualityStatus;
  products: CommodityWarehouseReceiptProductQuality[];
  errors: string[];
  warnings: string[];
}

interface CommodityWarehouseReceiptQualityOptions {
  startDate: string;
  endDate: string;
  maximumLagTradingDays?: number;
}

const DATE_PATTERN = /^\d{8}$/;
const DEFAULT_MAXIMUM_LAG_TRADING_DAYS = 3;
const MAXIMUM_INVALID_ROW_DETAILS = 8;

/** Audits the bounded warehouse-receipt window used by maintenance and Factor research. */
export async function auditCommodityWarehouseReceipts(
  options: CommodityWarehouseReceiptQualityOptions,
  database: Prisma = prisma,
): Promise<CommodityWarehouseReceiptQualitySummary> {
  assertOptions(options);
  const calendarEnd = addDays(options.endDate, 14);
  const [rows, calendarRows] = await Promise.all([
    database.commodityWarehouseReceipt.findMany({
      where: { tradeDate: { gte: options.startDate, lte: options.endDate } },
      orderBy: [{ productCode: 'asc' }, { tradeDate: 'asc' }, { unit: 'asc' }],
      select: {
        productCode: true,
        tradeDate: true,
        availableDate: true,
        sourceName: true,
        sourceUnit: true,
        unit: true,
        unitCorrectionApplied: true,
        volume: true,
        volumeChange: true,
        sourceRowCount: true,
      },
    }),
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: options.startDate, lte: calendarEnd },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
  ]);

  return summarizeCommodityWarehouseReceiptQuality(
    rows,
    calendarRows.map((row) => row.calDate),
    options.startDate,
    options.endDate,
    options.maximumLagTradingDays,
  );
}

export function summarizeCommodityWarehouseReceiptQuality(
  rows: CommodityWarehouseReceiptQualityRow[],
  openDates: string[],
  startDate: string,
  endDate: string,
  maximumLagTradingDays = DEFAULT_MAXIMUM_LAG_TRADING_DAYS,
): CommodityWarehouseReceiptQualitySummary {
  assertOptions({ startDate, endDate, maximumLagTradingDays });
  const sortedOpenDates = [...new Set(openDates)].sort();
  if (sortedOpenDates.some((date) => !DATE_PATTERN.test(date))) {
    throw new Error('Commodity warehouse-receipt audit open dates must use YYYYMMDD.');
  }
  const openDateSet = new Set(sortedOpenDates);
  const coverageOpenDates = sortedOpenDates.filter((date) => date <= endDate);
  const specificationByProduct = new Map<string, (typeof COMMODITY_FUTURE_SPECS)[number]>(
    COMMODITY_FUTURE_SPECS.map((specification) => [specification.productCode, specification]),
  );
  const validRows: CommodityWarehouseReceiptQualityRow[] = [];
  const invalidDetails: string[] = [];
  let invalidRows = 0;

  for (const row of rows) {
    const specification = specificationByProduct.get(row.productCode);
    const reasons: string[] = [];
    if (!specification) {
      reasons.push('unexpected product');
    } else {
      if (row.sourceName !== specification.warehouseReceipt.sourceName) {
        reasons.push('source-name drift');
      }
      if (!(specification.warehouseReceipt.units as readonly string[]).includes(row.unit)) {
        reasons.push('unexpected unit');
      }
      if (row.tradeDate < specification.warehouseReceipt.startDate) {
        reasons.push('report predates product coverage');
      }
    }
    if (!DATE_PATTERN.test(row.tradeDate) || row.tradeDate < startDate || row.tradeDate > endDate) {
      reasons.push('out-of-range report date');
    } else if (!openDateSet.has(row.tradeDate)) {
      reasons.push('non-trading report date');
    }
    if (
      !DATE_PATTERN.test(row.availableDate) ||
      row.availableDate <= row.tradeDate ||
      !openDateSet.has(row.availableDate)
    ) {
      reasons.push('invalid PIT availability');
    }
    if (!row.sourceUnit) {
      reasons.push('missing source unit');
    }
    if (!Number.isFinite(row.volume) || row.volume < 0) {
      reasons.push('invalid volume');
    }
    if (row.volumeChange != null && !Number.isFinite(row.volumeChange)) {
      reasons.push('invalid volume change');
    }
    if (!Number.isInteger(row.sourceRowCount) || row.sourceRowCount <= 0) {
      reasons.push('invalid source-row count');
    }
    const hasAuditedCorrection =
      row.productCode === 'AU' &&
      row.sourceUnit === '吨' &&
      row.unit === '千克' &&
      isAuditedAuKilogramMislabelDate(row.tradeDate);
    if (
      (row.unitCorrectionApplied && !hasAuditedCorrection) ||
      (!row.unitCorrectionApplied && row.sourceUnit != null && row.sourceUnit !== row.unit)
    ) {
      reasons.push('invalid unit correction');
    }

    if (reasons.length === 0) {
      validRows.push(row);
      continue;
    }
    invalidRows++;
    if (invalidDetails.length < MAXIMUM_INVALID_ROW_DETAILS) {
      invalidDetails.push(
        `${row.productCode} ${row.tradeDate} ${row.unit || 'n/a'}: ${reasons.join(', ')}`,
      );
    }
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  if (invalidRows > 0) {
    errors.push(
      `${invalidRows} invalid warehouse-receipt rows (${invalidDetails.join('; ')}${
        invalidRows > invalidDetails.length ? '; …' : ''
      })`,
    );
  }

  const products = COMMODITY_FUTURE_SPECS.map((specification) => {
    const productRows = validRows.filter((row) => row.productCode === specification.productCode);
    const latestTradeDate = productRows.at(-1)?.tradeDate ?? null;
    const latestRows = latestTradeDate
      ? productRows.filter((row) => row.tradeDate === latestTradeDate)
      : [];
    const latestAvailableDate =
      latestRows
        .map((row) => row.availableDate)
        .sort()
        .at(-1) ?? null;
    const lagTradingDays = latestTradeDate
      ? coverageOpenDates.filter((date) => date > latestTradeDate).length
      : null;
    const units = [...new Set(productRows.map((row) => row.unit))].sort();

    const productIsActive = specification.warehouseReceipt.startDate <= endDate;
    if (productIsActive) {
      if (!latestTradeDate || lagTradingDays == null) {
        errors.push(`${specification.productCode} has no valid rows in ${startDate}..${endDate}`);
      } else if (lagTradingDays > maximumLagTradingDays) {
        errors.push(
          `${specification.productCode} is stale by ${lagTradingDays} trading days; latest report ${latestTradeDate}`,
        );
      } else if (lagTradingDays > 0) {
        warnings.push(
          `${specification.productCode} trails ${endDate} by ${lagTradingDays} trading days; latest report ${latestTradeDate}`,
        );
      }
    }

    return {
      productCode: specification.productCode,
      rows: productRows.length,
      latestTradeDate,
      latestAvailableDate,
      lagTradingDays,
      units,
    };
  });
  const status: CommodityWarehouseReceiptQualityStatus =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'pass';

  return {
    startDate,
    endDate,
    rows: rows.length,
    invalidRows,
    maximumLagTradingDays,
    status,
    products,
    errors,
    warnings,
  };
}

function assertOptions(options: CommodityWarehouseReceiptQualityOptions): void {
  if (
    !DATE_PATTERN.test(options.startDate) ||
    !DATE_PATTERN.test(options.endDate) ||
    options.startDate > options.endDate
  ) {
    throw new Error('Commodity warehouse-receipt audit dates must use a valid YYYYMMDD range.');
  }
  const maximumLagTradingDays = options.maximumLagTradingDays ?? DEFAULT_MAXIMUM_LAG_TRADING_DAYS;
  if (!Number.isInteger(maximumLagTradingDays) || maximumLagTradingDays < 0) {
    throw new Error('Commodity warehouse-receipt maximum lag must be a non-negative integer.');
  }
}
