import { canonicalStockCode } from '../instruments/stock-identity.js';
import { stockMarketMembership, type StockMarketRange } from '../instruments/market-range.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';
import type { MarketPartition } from '../synchronization/partition.js';

/**
 * 已有股票身份优先；B 股编码区间和 ETF 目录仅用于确认维护范围外的证券。
 * 不从代码后缀或涨跌停来源的交易所标签推断股票身份。
 *
 * Existing stock identities take priority; B-share number ranges and the ETF catalog prove
 * exclusions only. Neither suffixes nor limit-response exchange labels establish stock identity.
 * SSE B shares: https://www.sse.com.cn/assortment/stock/list/share/
 * SZSE B shares: https://www.szse.cn/marketServices/technicalservice/doc/P020240510623040090566.pdf
 */
export function isOutsideStockLimitScope(
  code: string,
  stocks: ReadonlySet<string>,
  etfs: ReadonlySet<string>,
): boolean {
  if (stocks.has(canonicalStockCode(code))) {
    return false;
  }

  return etfs.has(code) || /^(?:900\d{3}|20\d{4})\.(?:SH|SZ|BJ)$/.test(code);
}

/**
 * 未知身份不进入业务记录；格式错误与真实目录冲突继续交给映射校验报错。
 *
 * Unknown identities never enter business records; mapping still rejects malformed identities
 * and real catalog conflicts before range exclusions can conceal them.
 */
export function selectStockLimitRows(
  rows: TushareRow[],
  partition: MarketPartition,
  ranges: ReadonlyMap<string, StockMarketRange>,
  etfs: ReadonlySet<string>,
) {
  const stocks = new Set(ranges.keys());
  const selected: TushareRow[] = [];
  const unknown = new Set<string>();
  let excludedRows = 0;

  for (const row of rows) {
    const code = String(row.ts_code);
    if (!/^\d{6}\.(SH|SZ|BJ)$/.test(code) || row.trade_date !== partition.startDate) {
      selected.push(row);
      continue;
    }
    const listing = ranges.get(canonicalStockCode(code));
    const exchangeConflict =
      listing?.exchange && row.exchange != null && listing.exchange !== row.exchange;
    const assetConflict = listing && row.asset_type != null && row.asset_type !== 'STK';
    if (exchangeConflict || assetConflict) {
      selected.push(row);
      continue;
    }

    if (isOutsideStockLimitScope(code, stocks, etfs)) {
      excludedRows++;
      continue;
    }
    const membership = stockMarketMembership(code, partition.startDate, ranges);
    if (membership === 'unknown') {
      unknown.add(code);
    } else if (membership === 'outside') {
      excludedRows++;
    } else {
      selected.push(row);
    }
  }

  return {
    rows: selected,
    excludedRows,
    gaps: unknown.size
      ? [`Unverified stock identities or market intervals: ${[...unknown].join(', ')}`]
      : [],
  };
}
