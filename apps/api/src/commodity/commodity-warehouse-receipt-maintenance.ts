import type { TradeDate } from '@jixie/shared';
import { prisma, type Prisma } from '../lib/prisma.js';
import type { TushareClient } from '../tushare/client.js';
import {
  auditCommodityWarehouseReceipts,
  type CommodityWarehouseReceiptProductQuality,
} from './commodity-warehouse-receipt-quality.js';
import { syncCommodityWarehouseReceipts } from './commodity-warehouse-receipts.js';

export interface CommodityWarehouseReceiptMaintenanceSummary {
  startDate: string;
  endDate: string;
  syncedRows: number;
  status: 'pass' | 'warn';
  products: CommodityWarehouseReceiptProductQuality[];
  warnings: string[];
}

interface CommodityWarehouseReceiptMaintenanceOptions {
  lookbackTradingDays?: number;
  maximumLagTradingDays?: number;
}

const DEFAULT_LOOKBACK_TRADING_DAYS = 20;
const DEFAULT_MAXIMUM_LAG_TRADING_DAYS = 3;

/** Refreshes a bounded revision window and rejects structurally invalid or stale results. */
export async function maintainCommodityWarehouseReceipts(
  client: TushareClient,
  endDate: TradeDate,
  database: Prisma = prisma,
  onLog: (line: string) => void = console.log,
  options: CommodityWarehouseReceiptMaintenanceOptions = {},
): Promise<CommodityWarehouseReceiptMaintenanceSummary> {
  const lookbackTradingDays = positiveInteger(
    options.lookbackTradingDays,
    DEFAULT_LOOKBACK_TRADING_DAYS,
  );
  const maximumLagTradingDays = nonNegativeInteger(
    options.maximumLagTradingDays,
    DEFAULT_MAXIMUM_LAG_TRADING_DAYS,
  );
  const recentDates = await database.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lte: endDate } },
    orderBy: { calDate: 'desc' },
    take: lookbackTradingDays,
    select: { calDate: true },
  });
  const startDate = recentDates.at(-1)?.calDate;
  if (!startDate) {
    throw new Error(
      `No SSE trading dates are available through ${endDate} for warehouse receipts.`,
    );
  }

  onLog(
    `Refreshing commodity warehouse receipts ${startDate}..${endDate} (${recentDates.length} trading-day window)`,
  );
  const syncedRows = await syncCommodityWarehouseReceipts(
    client,
    startDate as TradeDate,
    endDate,
    database,
    onLog,
  );
  const quality = await auditCommodityWarehouseReceipts(
    { startDate, endDate, maximumLagTradingDays },
    database,
  );
  if (quality.errors.length > 0) {
    throw new Error(`Commodity warehouse-receipt quality failed: ${quality.errors.join('; ')}`);
  }
  for (const warning of quality.warnings) {
    onLog(`Commodity warehouse-receipt warning: ${warning}`);
  }
  onLog(
    `Commodity warehouse receipts ${quality.status}: ${quality.rows} rows; ${quality.products
      .map(
        (product) =>
          `${product.productCode}=${product.latestTradeDate ?? 'missing'}${
            product.lagTradingDays ? `(-${product.lagTradingDays}d)` : ''
          }`,
      )
      .join(', ')}`,
  );

  return {
    startDate,
    endDate,
    syncedRows,
    status: quality.status === 'warn' ? 'warn' : 'pass',
    products: quality.products,
    warnings: quality.warnings,
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value != null && Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value != null && Number.isInteger(value) && value >= 0 ? value : fallback;
}
