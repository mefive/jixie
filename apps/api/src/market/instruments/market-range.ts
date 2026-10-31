import { canonicalStockCode, hasStockCodePredecessor } from './stock-identity.js';
import { isObservationDate } from '../synchronization/date.js';

export const STOCK_LIST_STATUSES = ['L', 'D', 'P', 'G', 'UN'] as const;

interface StockListing {
  tsCode: string;
  listDate: string | null;
  delistDate: string | null;
  listStatus: string;
}

export interface StockMarketRange {
  startDate?: string;
  endDate?: string;
  listStatus: string;
  uncertain: boolean;
  predecessorUnknown: boolean;
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
export function confirmedMarketStart(code: string) {
  return CONFIRMED_ADMISSIONS[code] ?? (/^\d{6}\.BJ$/.test(code) ? BSE_OPENING : undefined);
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
      predecessorUnknown: missingPredecessor,
      uncertain:
        !current ||
        !STOCK_LIST_STATUSES.some((status) => status === listStatus) ||
        listings.some((stock) => stock.listDate != null && !isObservationDate(stock.listDate)) ||
        (current.delistDate != null && !endDate) ||
        (listStatus === 'D' && !endDate) ||
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
  const confirmed = confirmedMarketStart(canonical);
  if (confirmed && date < confirmed.date) {
    return 'outside';
  }

  const range = ranges.get(canonical);
  if (!range || range.uncertain) {
    return 'unknown';
  }
  if (range.endDate && date > range.endDate) {
    return 'outside';
  }
  if (range.startDate && date < range.startDate) {
    return range.predecessorUnknown ? 'unknown' : 'outside';
  }
  if (range.listStatus === 'G' || range.listStatus === 'UN') {
    return range.startDate ? 'unknown' : 'outside';
  }
  if (!range.startDate) {
    return 'unknown';
  }

  return 'inside';
}
