import { it, expect } from 'vitest';
import { withVersionedStorage } from '../../tests/versioned-storage.js';
import { withMarketAccess } from '#infra/coordination/market-access.js';
import { getMarketDatabase } from '#infra/database/market-database.js';
import { changeDownloadList, DEFAULT_INDEX_DOWNLOADS } from '#market/downloads/lists.js';
import type { SyncSource } from '#market/synchronization/source.js';
import { ingestCandidate, inspectCandidate, acceptCandidate } from './replica.js';

const first = '20161116';
const last = '20261113';
const dates = [first, '20210104', last];
const funds = [
  { code: '510000.SH', listing: first },
  { code: '510001.SH', listing: dates[1] },
];
const source: SyncSource = {
  async call(api, params = {}) {
    const date = String(params.trade_date);
    switch (api) {
      case 'trade_cal':
        return params.exchange === 'SSE'
          ? dates
              .filter((day) => day >= String(params.start_date) && day <= String(params.end_date))
              .map((cal_date) => ({ exchange: 'SSE', cal_date, is_open: 1 }))
          : [];
      case 'stock_basic':
        return params.list_status === 'L'
          ? [
              {
                ts_code: '600001.SH',
                symbol: '600001',
                name: 'Future',
                exchange: 'SSE',
                list_status: 'L',
                list_date: '20300101',
              },
            ]
          : [];
      case 'etf_basic':
        return funds.map((f) => ({
          ts_code: f.code,
          extname: f.code,
          list_status: 'L',
          list_date: f.listing,
          exchange: 'SH',
          etf_type: '纯境内',
        }));
      case 'fund_basic':
        return funds.map((f) => ({
          ts_code: f.code,
          fund_type: '股票型',
          list_date: f.listing,
          status: 'L',
        }));
      case 'etf_share_size':
        return funds
          .filter((f) => f.listing <= date)
          .map((f) => ({ ts_code: f.code, trade_date: date, total_size: 1 }));
      case 'fund_adj':
      case 'fund_daily': {
        const fund = funds.find((f) => f.code === params.ts_code)!;
        return dates
          .filter(
            (day) =>
              day >= fund.listing &&
              day >= String(params.start_date) &&
              day <= String(params.end_date),
          )
          .map((trade_date) => ({
            ts_code: fund.code,
            trade_date,
            ...(api === 'fund_adj' ? { adj_factor: 1 } : { open: 10, high: 11, low: 9, close: 10 }),
          }));
      }
      default:
        return [];
    }
  },
};

async function collectTargets(targets: string[]) {
  return withVersionedStorage(async () => {
    for (const index of DEFAULT_INDEX_DOWNLOADS) {
      await changeDownloadList('index', 'remove', index.tsCode);
    }
    for (const targetDate of targets) {
      const clock = () =>
        new Date(
          targetDate.slice(0, 4) +
            '-' +
            targetDate.slice(4, 6) +
            '-' +
            targetDate.slice(6) +
            'T10:00:00Z',
        );
      const result = await ingestCandidate({ source, targetDate, clock, onLog: () => {} }, true);
      expect(result.phase).toBe('awaiting_publish');
      const review = await inspectCandidate(result.runId);
      expect(review.pending).toBe(0);
      await acceptCandidate(result.runId, review.candidateVersion);
      if (targetDate === first) {
        await withMarketAccess(async () =>
          expect(await getMarketDatabase().etfBasic.count()).toBe(1),
        );
      }
    }

    return withMarketAccess(async () => {
      const db = getMarketDatabase();
      return {
        bars: await db.etfDaily.findMany({ orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }] }),
        adjustments: await db.etfAdjFactor.findMany({
          orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
        }),
        codes: await db.etfBasic.findMany({
          select: { tsCode: true, listDate: true },
          orderBy: { tsCode: 'asc' },
        }),
      };
    });
  });
}

it('publishes the same ETF history after a ten-year gap as a fresh full collection', async () => {
  const resumed = await collectTargets([first, last]);
  const fresh = await collectTargets([last]);
  expect(resumed).toEqual(fresh);
  expect(resumed.bars).toHaveLength(5);
  expect(resumed.adjustments).toHaveLength(5);
  expect(resumed.codes).toHaveLength(2);
}, 120_000);
