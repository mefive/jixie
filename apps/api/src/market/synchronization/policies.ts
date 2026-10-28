import type { DatasetPolicy } from './partition.js';

/**
 * 目录是既有资产范围与确定历史边界，刷新周期不是执行模式。
 *
 * Catalog bounds the existing asset scope; refresh intervals are not execution modes.
 */
function policy(
  dataset: string,
  startDate: string,
  period: DatasetPolicy['period'],
  options: Partial<DatasetPolicy> = {},
): DatasetPolicy {
  return {
    dataset,
    startDate,
    period,
    calendar: 'SSE',
    timeZone: 'Asia/Shanghai',
    closeHour: 16,
    revisionDays: 20,
    refreshDays: 1,
    version: 'sync-v1',
    ...options,
  };
}

export const DATASET_POLICIES = [
  policy('calendar', '19900101', 'year', { closeHour: 0 }),
  policy('stock-master', '19900101', 'catalog', { closeHour: 0 }),
  policy('stock-names', '19900101', 'year', { refreshDays: 7, closeHour: 0 }),
  ...['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'].map((dataset) =>
    policy(dataset, '20150101', 'day'),
  ),
  policy('index-catalog', '19900101', 'catalog', { closeHour: 0 }),
  policy('index-prices', '19900101', 'year'),
  policy('index-valuations', '20040101', 'year'),
  policy('index-weights', '20150101', 'month', { refreshDays: 7, revisionDays: 190 }),
  policy('etf-master', '20150101', 'catalog', { closeHour: 0 }),
  policy('etf-prices', '20150101', 'year', { revisionDays: 366 }),
  policy('etf-adjustments', '20150101', 'year', { revisionDays: 366 }),
  policy('etf-shares', '20150101', 'day', { revisionDays: 366 }),
  policy('financial-statements', '20141231', 'quarter', {
    refreshDays: 7,
    revisionDays: 750,
    closeHour: 0,
  }),
  policy('financial-indicators', '20141231', 'quarter', {
    refreshDays: 7,
    revisionDays: 750,
    closeHour: 0,
  }),
  policy('dividends', '19900101', 'year', { refreshDays: 7, revisionDays: 750, closeHour: 0 }),
] satisfies DatasetPolicy[];
