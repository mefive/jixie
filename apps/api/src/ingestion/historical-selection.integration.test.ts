import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { ingest } from './ingest.js';
import { readDownloadCodes } from '#market/downloads/lists.js';
import type { SyncSource } from '#market/synchronization/source.js';
import type { TushareRow } from '#market/providers/tushare/tushare-client.js';

const historicalDates = ['20180102', '20180103'];
const clock = () => new Date('2018-01-04T10:00:00Z');
const catalog = Array.from({ length: 101 }, (_, index) => ({
  ts_code: `${500000 + index}.SH`,
  extname: `ETF ${index}`,
  list_status: index === 0 ? 'D' : 'L',
  list_date: index === 100 ? '20180103' : '20180102',
  exchange: 'SH',
  etf_type: '纯境内',
}));

function historicalSource(
  options: {
    onCall?: (api: string, params: Record<string, unknown>) => void;
    failSelection?: () => boolean;
  } = {},
): SyncSource {
  return {
    async call(api, params = {}): Promise<TushareRow[]> {
      options.onCall?.(api, params);
      switch (api) {
        case 'trade_cal':
          return params.exchange === 'SSE'
            ? historicalDates
                .filter(
                  (date) => date >= String(params.start_date) && date <= String(params.end_date),
                )
                .map((cal_date) => ({ exchange: 'SSE', cal_date, is_open: 1 }))
            : [];
        case 'stock_basic':
          return params.list_status === 'L'
            ? [
                {
                  ts_code: '600001.SH',
                  symbol: '600001',
                  name: 'Future listing',
                  exchange: 'SSE',
                  list_status: 'L',
                  list_date: '20200101',
                  delist_date: null,
                },
              ]
            : [];
        case 'etf_basic':
          return [
            ...catalog,
            {
              ts_code: '158008.OF',
              extname: 'Future ETF without fund enrichment',
              list_status: 'L',
              list_date: '20260828',
              exchange: 'SZ',
              etf_type: '纯境内',
            },
          ];
        case 'fund_basic':
          return catalog.map((row, index) => ({
            ts_code: row.ts_code,
            fund_type: '股票型',
            delist_date: index === 0 ? '20180104' : null,
          }));
        case 'etf_share_size': {
          if (params.trade_date === '20180103' && options.failSelection?.()) {
            if (params.offset) {
              throw new Error('Controlled historical size page failure');
            }

            return Array.from({ length: 5000 }, (_, index) => ({
              ts_code: `${500000 + index}.SH`,
              trade_date: String(params.trade_date),
              total_size: index + 1,
            }));
          }

          return catalog
            .filter((row) => row.list_date <= String(params.trade_date))
            .map((row, index) => ({
              ts_code: row.ts_code,
              trade_date: String(params.trade_date),
              total_size: index + 1,
            }));
        }
        case 'fund_daily':
        case 'fund_adj': {
          const row = catalog.find((candidate) => candidate.ts_code === params.ts_code)!;
          const values: TushareRow =
            api === 'fund_daily' ? { open: 10, high: 11, low: 9, close: 10 } : { adj_factor: 1 };

          return [
            { ts_code: String(params.ts_code), trade_date: row.list_date, ...values },
            { ts_code: String(params.ts_code), trade_date: '20170101', close: -1, adj_factor: -1 },
            { ts_code: String(params.ts_code), trade_date: '20200101', close: -1, adj_factor: -1 },
          ];
        }
        case 'namechange':
          return [];
        default:
          throw new Error(`Unexpected historical selection request ${api}`);
      }
    },
  };
}

it(
  'unions daily historical top 100s, admits former leaders, and filters future metadata before validation',
  async () =>
    withSyncDatabase(async (database) => {
      await database.ingestionSelection.createMany({
        data: [
          { assetType: 'etf', codes: [] },
          { assetType: 'index', codes: [] },
        ],
      });
      const input = {
        targetDate: '20180103',
        clock,
        onLog: () => {},
        source: historicalSource(),
      };
      const first = await ingest(input);
      expect(first.status).toBe('completed');
      expect(await readDownloadCodes('etf')).toHaveLength(101);
      expect(await readDownloadCodes('etf')).toContain('500000.SH');
      expect(await readDownloadCodes('etf')).toContain('500100.SH');
      expect(await database.etfBasic.findUnique({ where: { tsCode: '158008.OF' } })).toBeNull();
      expect(await database.ingestionIssue.count()).toBe(0);
      expect(await database.etfDaily.count()).toBe(101);
      expect(await database.etfDaily.count({ where: { tradeDate: { lt: '20180102' } } })).toBe(0);
      expect(
        await database.etfDaily.count({ where: { tradeDate: { gt: input.targetDate } } }),
      ).toBe(0);
      const selections = await database.ingestionBatch.findMany({
        where: { dataset: 'etf-selection' },
        orderBy: { period: 'asc' },
      });
      expect(selections).toMatchObject([
        { period: '20180102', acceptedCount: 100, status: 'succeeded' },
        { period: '20180103', acceptedCount: 100, filteredCount: 1, status: 'succeeded' },
      ]);
      const settings = await database.ingestionSelection.findMany();
      const calls: string[] = [];
      const second = await ingest({
        ...input,
        source: historicalSource({ onCall: (api) => calls.push(api) }),
      });
      expect(second.status).toBe('completed');
      expect(calls).not.toContain('etf_share_size');
      expect(calls).not.toContain('fund_daily');
      expect(await database.ingestionSelection.findMany()).toEqual(settings);
      expect(await database.etfDaily.count()).toBe(101);
    }),
  60_000,
);

it(
  'does not merge a half-downloaded ranking, then retries only the failed historical selection',
  async () =>
    withSyncDatabase(async (database) => {
      await database.ingestionSelection.create({ data: { assetType: 'index', codes: [] } });
      let fail = true;
      const requestedDates: unknown[] = [];
      const input = {
        targetDate: '20180103',
        clock,
        onLog: () => {},
        source: historicalSource({
          failSelection: () => fail,
          onCall: (api, params) => {
            if (api === 'etf_share_size') {
              requestedDates.push(params.trade_date);
            }
          },
        }),
      };
      expect((await ingest(input)).status).toBe('completed_with_issues');
      expect(await readDownloadCodes('etf')).toHaveLength(100);
      expect(await readDownloadCodes('etf')).not.toContain('500100.SH');
      expect(await database.etfDaily.count()).toBe(100);
      fail = false;
      requestedDates.length = 0;
      expect((await ingest(input)).status).toBe('completed');
      expect(requestedDates).toEqual(['20180103']);
      expect(await readDownloadCodes('etf')).toHaveLength(101);
      expect(await database.etfDaily.count()).toBe(101);
    }),
  60_000,
);

it(
  'rolls the selection union back with its receipt and recovers after cancellation',
  async () =>
    withSyncDatabase(async (database) => {
      await database.ingestionSelection.create({ data: { assetType: 'index', codes: [] } });
      await database.$executeRawUnsafe(
        `CREATE TRIGGER refuse_selection_receipt BEFORE UPDATE ON "IngestionBatch" WHEN NEW.dataset='etf-selection' AND NEW.period='20180103' AND NEW.status='succeeded' BEGIN SELECT RAISE(ABORT, 'controlled selection receipt failure'); END`,
      );
      const input = {
        targetDate: '20180103',
        clock,
        onLog: () => {},
        source: historicalSource(),
      };
      expect((await ingest(input)).status).toBe('failed');
      expect(await readDownloadCodes('etf')).toHaveLength(100);
      expect(await readDownloadCodes('etf')).not.toContain('500100.SH');
      await database.$executeRawUnsafe('DROP TRIGGER refuse_selection_receipt');
      const controller = new AbortController();
      const interrupted = await ingest({
        ...input,
        signal: controller.signal,
        source: historicalSource({
          onCall: (api) => {
            if (api === 'etf_share_size') {
              controller.abort();
            }
          },
        }),
      });
      expect(interrupted.status).toBe('interrupted');
      expect(await readDownloadCodes('etf')).toHaveLength(100);
      expect((await ingest(input)).status).toBe('completed');
      expect(await readDownloadCodes('etf')).toHaveLength(101);
      expect(await database.etfDaily.count()).toBe(101);
    }),
  60_000,
);
