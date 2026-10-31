import { canonicalStockCode, hasStockCodePredecessor } from './stock-identity.js';
import { isObservationDate } from '../synchronization/date.js';
import type { ListingInterval } from '../synchronization/catalog-coverage.js';

export const STOCK_LIST_STATUSES = ['L', 'D', 'P'] as const;

interface StockListing {
  tsCode: string;
  listDate?: string | null;
  delistDate?: string | null;
  listStatus: string;
  exchange?: string | null;
}

export interface StockMarketRange {
  startDate?: string;
  endDate?: string;
  listStatus: string;
  uncertain: boolean;
  predecessorUnknown: boolean;
  exchange?: string | null;
}

/**
 * 交易所开市及已核实的市场进入日期，不用当前证券目录推断前身市场历史。
 *
 * Verified exchange opening and admission dates; today's catalog cannot prove predecessor history.
 */
const BSE_OPENING = {
  date: '20211115',
  source: 'https://www.bse.cn/company/introduce.html',
};
const CONFIRMED_ADMISSIONS: Record<string, { date: string; source: string }> = {
  '920139.BJ': {
    date: '20221028',
    source: 'https://www.bse.cn/issue_report_meeting/200013551.html',
  },
  '920476.BJ': {
    date: '20221014',
    source: 'https://www.bse.cn/disclosure/2026/2026-07-03/b520c75213b247ad8d74cdbe8d253689.pdf',
  },
  '920718.BJ': {
    date: '20221222',
    source: 'https://www.bse.cn/disclosure/2026/2026-04-20/cab723016e0840c99223a616496b2150.pdf',
  },
  '920879.BJ': {
    date: '20221220',
    source: 'https://www.bse.cn/issue_report_meeting/200014236.html',
  },
};

/**
 * 仅返回能证明此前不属于本市场的边界；未确认证券不产生删除依据。
 *
 * Return only proven exclusions before market entry; unknown securities provide no deletion proof.
 */
export function confirmedMarketStart(code: string, exchange?: string | null) {
  if (exchange && exchange !== 'BSE') {
    return undefined;
  }

  return CONFIRMED_ADMISSIONS[code] ?? (exchange === 'BSE' ? BSE_OPENING : undefined);
}

/**
 * 同市场代码接续保留最早上市日，终止边界只取新代码，旧代码退役不等于证券退市。
 *
 * Preserve the earliest listing across aliases; retiring an old code does not delist its successor.
 */
export function stockMarketRanges(stocks: readonly StockListing[]): Map<string, StockMarketRange> {
  const groups = new Map<string, StockListing[]>();
  for (const stock of stocks) {
    const code = canonicalStockCode(stock.tsCode);
    const group = groups.get(code) ?? [];
    group.push(stock);
    groups.set(code, group);
  }

  const ranges = new Map<string, StockMarketRange>();
  for (const [code, listings] of groups) {
    const current = listings.find((stock) => stock.tsCode === code);
    const dates = listings
      .map((stock) => stock.listDate)
      .filter(isObservationDate)
      .sort();
    const startDate = dates[0];
    const endDate = isObservationDate(current?.delistDate) ? current.delistDate : undefined;
    const listStatus = current?.listStatus ?? listings[0].listStatus;
    const missingPredecessor =
      hasStockCodePredecessor(code) &&
      !listings.some((stock) => stock.tsCode !== code && isObservationDate(stock.listDate));

    ranges.set(code, {
      startDate,
      endDate,
      listStatus,
      exchange: current?.exchange,
      predecessorUnknown: missingPredecessor,
      uncertain:
        !current ||
        !['L', 'D', 'P', 'G', 'UN'].includes(listStatus) ||
        listings.some((stock) => stock.listDate != null && !isObservationDate(stock.listDate)) ||
        (current.delistDate != null && !endDate) ||
        (listStatus === 'D' && !endDate) ||
        Boolean(CONFIRMED_ADMISSIONS[code] && current.exchange && current.exchange !== 'BSE') ||
        Boolean(startDate && endDate && endDate < startDate),
    });
  }

  return ranges;
}

/**
 * 入库和覆盖使用同一日期判断；当前暂停／未交易状态不能回填历史停牌区间。
 *
 * Ingestion and coverage share dated membership; current status cannot invent past suspensions.
 */
export function stockMarketMembership(
  code: string,
  date: string,
  ranges: ReadonlyMap<string, StockMarketRange>,
): 'inside' | 'outside' | 'unknown' {
  const canonical = canonicalStockCode(code);
  const range = ranges.get(canonical);
  if (range?.listStatus === 'G' || range?.listStatus === 'UN') {
    return 'outside';
  }
  const confirmed = confirmedMarketStart(canonical, range?.exchange);
  if (confirmed && date < confirmed.date) {
    return 'outside';
  }

  if (!range || range.uncertain) {
    return 'unknown';
  }
  if (range.endDate && date > range.endDate) {
    return 'outside';
  }
  if (range.startDate && date < range.startDate) {
    return range.predecessorUnknown ? 'unknown' : 'outside';
  }
  if (!range.startDate || !['SSE', 'SZSE', 'BSE'].includes(range.exchange ?? '')) {
    return 'unknown';
  }

  return 'inside';
}

/**
 * 将目录转换为覆盖依赖的区间，排除从未上市者并保留历史身份接续。
 *
 * Derive coverage intervals, excluding never-listed entries and preserving predecessor history.
 */
export function stockCoverageIntervals(
  stocks: readonly StockListing[],
): Map<string, ListingInterval> {
  const intervals = new Map<string, ListingInterval>();
  for (const [code, range] of stockMarketRanges(stocks)) {
    if (range.listStatus === 'G' || range.listStatus === 'UN') {
      continue;
    }
    const admission = confirmedMarketStart(code, range.exchange);
    const dates = ['20150101', admission?.date ?? '20150101'];
    if (!range.predecessorUnknown && range.startDate) {
      dates.push(range.startDate);
    }
    intervals.set(code, {
      startDate: dates.sort().at(-1)!,
      endDate: range.endDate,
      exchange: range.exchange,
      uncertain: range.uncertain,
    });
  }

  return intervals;
}
