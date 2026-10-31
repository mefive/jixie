import { canonicalStockCode } from './stock-identity.js';

/**
 * 公告确认的历史非交易区间，首尾均包含；恢复上市与重组停牌分别记录。
 *
 * Announcement-confirmed non-trading intervals, inclusive; listing and trading resumptions differ.
 */
export const STOCK_TRADING_INTERRUPTION_HISTORY = [
  {
    code: '000520.SZ',
    from: '20140516',
    to: '20150817',
    kind: 'listing-suspension',
    source: 'https://static.cninfo.com.cn/finalpage/2015-12-18/1201844007.PDF',
  },
  {
    code: '000520.SZ',
    from: '20150818',
    to: '20151217',
    kind: 'trading-suspension',
    source: 'https://static.cninfo.com.cn/finalpage/2015-12-18/1201844011.PDF',
  },
  {
    code: '002506.SZ',
    from: '20140528',
    to: '20150811',
    kind: 'listing-suspension',
    source:
      'https://vip.stock.finance.sina.com.cn/corp/view/vISSUE_MarketBulletinDetail.php?id=1908533&stockid=002506',
  },
  {
    code: '000594.SZ',
    from: '20140717',
    to: '20150528',
    kind: 'listing-suspension',
    source: 'https://www.szse.cn/disclosure/notice/general/t20150522_501451.html',
  },
  {
    code: '601268.SH',
    from: '20140526',
    to: '20150521',
    kind: 'listing-suspension',
    source:
      'https://www.sse.com.cn/disclosure/bond/corporate/issue/corporatebulletin/c/2560621979219550.pdf',
  },
] as const;

export function confirmedTradingInterruptions(date: string): Set<string> {
  return new Set(
    STOCK_TRADING_INTERRUPTION_HISTORY.filter(
      (interval) => interval.from <= date && date <= interval.to,
    ).map((interval) => canonicalStockCode(interval.code)),
  );
}
