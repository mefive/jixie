import type { Prisma } from '#infra/database/prisma.js';
import { formatNumber, formatPercent } from '../quality/format.js';
import type { AuditFinding } from '../quality/report.js';
import { auditCommodityContinuousReturns } from './commodity-continuous-return-quality.js';
import { auditCommodityHoldingPositions } from './commodity-holding-quality.js';
import { auditCommodityWarehouseReceipts } from './commodity-warehouse-receipt-quality.js';

export async function auditCommodityWarehouseReceiptPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditCommodityWarehouseReceipts(
    { startDate, endDate, maximumLagTradingDays: 3 },
    database,
  );

  return {
    id: 'commodity-warehouse-receipt-pit',
    title: 'Commodity warehouse receipts: coverage and point-in-time availability',
    status: summary.status,
    summary: `${formatNumber(summary.rows)} rows; ${summary.invalidRows} invalid; ${summary.errors.length} errors and ${summary.warnings.length} warnings`,
    details: [
      ...summary.products.map(
        (product) =>
          `${product.productCode}: ${formatNumber(product.rows)} rows, latest ${product.latestTradeDate ?? 'n/a'}, available ${product.latestAvailableDate ?? 'n/a'}, lag ${product.lagTradingDays ?? 'n/a'} trading days, units ${product.units.join('/') || 'n/a'}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'Absolute levels remain product- and unit-specific; SC barrel and tonne series must never be added without a documented conversion.',
    ],
  };
}

export async function auditCommodityHoldingPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditCommodityHoldingPositions({ startDate, endDate }, database);
  return {
    id: 'commodity-holding-pit',
    title: 'Commodity ranked-member positions: coverage and point-in-time availability',
    status: summary.status,
    summary: `${formatNumber(summary.rows)} product-days; ${summary.invalidRows} invalid; ${summary.errors.length} errors and ${summary.warnings.length} warnings`,
    details: [
      ...summary.products.map(
        (product) =>
          `${product.productCode}: ${formatNumber(product.observedDates)}/${formatNumber(product.expectedDates)} representative-contract dates (${formatPercent(product.coverage)}), latest ${product.latestObservedDate ?? 'n/a'}, trailing gaps ${product.trailingMissingDates}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'The stored long/short values aggregate exchange ranking subsets for the maximum-open-interest actual contract; they are not whole-market positions or a trader classification.',
      'SC is excluded because repeated Tushare INE probes returned empty; no proxy is substituted.',
    ],
  };
}

export async function auditCommodityContinuousReturnPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditCommodityContinuousReturns({ startDate, endDate }, database);
  return {
    id: 'commodity-continuous-return-pit',
    title: 'Commodity main-contract returns: mapping, roll decomposition, and PIT',
    status: summary.status,
    summary: `${formatNumber(summary.rows)} return rows; ${summary.invalidRows} invalid; ${summary.errors.length} errors and ${summary.warnings.length} warnings`,
    details: [
      ...summary.products.map(
        (product) =>
          `${product.productCode}: mappings ${formatNumber(product.mappingDates)}/${formatNumber(product.expectedOpenDates)} (${formatPercent(product.mappingCoverage)}), return source ${formatPercent(product.returnSourceCoverage)}, ${product.rollDays} mapped roll days, latest ${product.latestReturnDate ?? 'n/a'}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'The continuous return uses the current mapped contract at both interval endpoints. The separately stored roll gap is a code-switch basis; rollYieldProxy is explanatory and is not realized daily P&L.',
    ],
  };
}
