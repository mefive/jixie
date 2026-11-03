import { getDatabase } from '#infra/database/prisma.js';
import { stockMarketRanges } from '../instruments/market-range.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { isObservationDate } from '../synchronization/date.js';
import { recordImportIssue } from '../synchronization/diagnostics.js';
import type { PreparedMarketPartition } from '../synchronization/partition.js';
import { completeResponse, fetchSourcePages, type SyncSource } from '../synchronization/source.js';

/**
 * 目录与业务下载共用相同的报表种类和报告类型。
 *
 * Catalog discovery and business downloads use the same statement and report types.
 */
export const FINANCIAL_PERIOD_SOURCES = [
  ...Object.entries({
    income: 'income_vip',
    balance_sheet: 'balancesheet_vip',
    cash_flow: 'cashflow_vip',
  }).flatMap(([kind, api]) =>
    ['1', '4', '5'].map((reportType) => ({
      scope: `${kind}|${reportType}`,
      api,
      reportType,
      dataset: 'financial-statements',
    })),
  ),
  {
    scope: 'all',
    api: 'fina_indicator_vip',
    dataset: 'financial-indicators',
    reportType: undefined,
  },
] as const;

/**
 * 上市截止日只筛选证券，不裁剪已纳入公司的上市前报告。
 *
 * The listing cutoff selects securities without truncating their pre-listing reports.
 */
export async function financialStockCodes(targetDate: string): Promise<Set<string>> {
  const stocks = await getDatabase().stockBasic.findMany();
  const ranges = stockMarketRanges(stocks);

  return new Set(
    stocks
      .map((row) => canonicalStockCode(row.tsCode))
      .filter((code) => {
        const start = ranges.get(code)?.startDate;

        return !start || start <= targetDate;
      }),
  );
}

/**
 * 完整扫描轻量身份列取得实际报告期；不猜年份、不借用上市日，也不在空季度停止。
 *
 * Scan complete identity columns for actual report periods without guessing a year,
 * borrowing listing dates, or stopping at empty quarters.
 */
export async function prepareFinancialPeriodCatalog(
  source: SyncSource,
  scope: string,
  targetDate: string,
): Promise<PreparedMarketPartition> {
  const definition = FINANCIAL_PERIOD_SOURCES.find((entry) => entry.scope === scope);
  if (!definition) {
    throw new Error(`Unknown financial period catalog ${scope}`);
  }

  const codes = await financialStockCodes(targetDate);
  const periods = new Set<string>();
  const errors: string[] = [];
  const pages = await fetchSourcePages(
    source,
    definition.api,
    definition.reportType ? { report_type: definition.reportType } : {},
    'ts_code,end_date',
    undefined,
    10000,
    (rows) => {
      for (const row of rows) {
        if (!codes.has(canonicalStockCode(String(row.ts_code)))) {
          continue;
        }
        if (!isObservationDate(row.end_date)) {
          const message = 'Invalid financial catalog report period';
          errors.push(message);
          recordImportIssue({
            category: 'record',
            reasonCode: 'invalid_report_period',
            message,
            payload: row,
          });
          continue;
        }
        if (row.end_date <= targetDate) {
          periods.add(row.end_date);
        }
      }
    },
  );
  const result = completeResponse({
    pages,
    table: 'FinancialPeriodCatalog',
    records: [],
    errors,
    allowEmpty: true,
  });
  result.tables = [];
  result.observedDates = [...periods].sort();
  result.checks.excludedRows = (pages.rowCount ?? 0) - periods.size - errors.length;

  return result;
}
