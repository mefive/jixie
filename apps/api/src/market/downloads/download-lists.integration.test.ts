import { ingest } from '#ingestion/ingest.js';
import { planIngestion } from '#ingestion/plan.js';
import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { selectTopEtfs } from './select-etfs.js';
import {
  changeDownloadList,
  readDownloadCodes,
  listDownloads,
  initializeIndexDownloads,
} from './lists.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import type { SyncSource } from '../synchronization/source.js';

function fixtureSource(
  options: {
    missingSize?: string;
    invalidDate?: boolean;
    failPage?: boolean;
    pending?: boolean;
  } = {},
) {
  const catalog = Array.from({ length: 125 }, (_, index) => ({
    ts_code: `${500000 + index}.SH`,
    extname: `ETF ${index}`,
    cname: `ETF ${index}`,
    index_code: '000300.SH',
    index_name: '沪深300',
    setup_date: '20150101',
    list_date: '20150105',
    list_status: index === 124 ? 'D' : 'L',
    exchange: 'SH',
    mgr_name: 'Fixture',
    custod_name: 'Fixture',
    mgt_fee: 0.5,
    etf_type: '境内',
  }));
  const calls: Array<{ api: string; params: Record<string, unknown> }> = [];
  const source: SyncSource = {
    async call(api, params = {}) {
      calls.push({ api, params });
      switch (api) {
        case 'etf_basic':
          return [
            ...catalog,
            ...(options.pending
              ? [
                  {
                    ts_code: '158025.OF',
                    extname: '鹏华创业板成长ETF',
                    list_status: 'P',
                    exchange: 'SZ',
                    etf_type: '纯境内',
                  },
                  {
                    ts_code: '515470.OF',
                    extname: '南方中证人工智能主题ETF',
                    list_status: 'P',
                    exchange: 'SH',
                    etf_type: '纯境内',
                  },
                  {
                    ts_code: '158079.OF',
                    extname: '华安创业板电池ETF',
                    list_status: 'P',
                    exchange: null,
                    etf_type: '纯境内',
                  },
                ]
              : []),
          ];
        case 'fund_basic':
          return catalog.map((row) => ({
            ts_code: row.ts_code,
            fund_type: '股票型',
            delist_date: null,
          }));
        case 'trade_cal':
          return [
            { cal_date: '20261026', is_open: 1 },
            { cal_date: '20261027', is_open: 1 },
          ];
        case 'etf_share_size':
          if (options.failPage) {
            if (params.offset) {
              throw new Error('Fixture page failed');
            }
            return Array.from({ length: 5000 }, (_, index) => ({
              ts_code: `${500000 + index}.SH`,
              trade_date: '20261027',
              total_size: index + 1,
            }));
          }
          return catalog.map((row, index) => ({
            ts_code: row.ts_code,
            trade_date: options.invalidDate ? '20261026' : String(params.trade_date),
            total_size: options.missingSize === row.ts_code ? null : index + 1,
          }));
        default:
          throw new Error(`Unexpected source ${api}`);
      }
    },
  };

  return { source, calls };
}

const policy = (dataset: string) => dataset;
async function datasetScopes(dataset: string) {
  const plan = await planIngestion('20261027', new Date('2026-10-28T10:00:00Z'));
  return [
    ...new Set(plan.units.filter((unit) => unit.dataset === dataset).map((unit) => unit.scope)),
  ].map((scope) => ({ scope }));
}

describe('administrator download lists', () => {
  it('ignores incomplete pending records, retains listed/delisted funds and initializes the top 100', async () =>
    withSyncDatabase(async (database) => {
      const { source, calls } = fixtureSource({ missingSize: '500120.SH', pending: true });
      const selected = await selectTopEtfs({ source, today: '20261028' });

      expect(selected.selectedCodes).toHaveLength(100);
      expect(selected.selectedCodes[0]).toBe('500123.SH');
      expect(selected.selectedCodes).not.toContain('500124.SH');
      expect(selected.missingSizeCodes).toEqual(['500120.SH']);
      expect(await database.etfBasic.count()).toBe(125);
      expect(await database.etfBasic.count({ where: { listStatus: 'P' } })).toBe(0);
      expect(await database.etfBasic.findUnique({ where: { tsCode: '500124.SH' } })).toMatchObject({
        listStatus: 'D',
      });
      expect(await readDownloadCodes('etf')).toEqual(selected.selectedCodes);
      expect(calls.some((call) => ['fund_daily', 'fund_adj'].includes(call.api))).toBe(false);
      expect(calls.find((call) => call.api === 'etf_share_size')?.params).toMatchObject({
        trade_date: '20261027',
      });
      expect((await datasetScopes(policy('etf-prices'))).map((row) => row.scope)).toEqual(
        expect.arrayContaining(selected.selectedCodes),
      );
    }));

  it(
    'keeps a saved empty list during daily sync and never repeats size selection',
    async () =>
      withSyncDatabase(async (database) => {
        await database.ingestionSelection.createMany({
          data: [
            { assetType: 'etf', codes: [] },
            { assetType: 'index', codes: [] },
          ],
        });
        const calls: string[] = [];
        await ingest({
          targetDate: '19901220',
          clock: () => new Date('1990-12-21T10:00:00Z'),
          source: {
            async call(api) {
              calls.push(api);
              return [];
            },
          },
          onLog: () => {},
        });

        expect(calls).not.toContain('etf_share_size');
        expect(await readDownloadCodes('etf')).toEqual([]);
        expect(await readDownloadCodes('index')).toEqual([]);
      }),
    30_000,
  );

  it.each([{ invalidDate: true }, { failPage: true }])(
    'preserves the saved list and snapshot after a failed or inconsistent source: %j',
    async (options) =>
      withSyncDatabase(async (database) => {
        await selectTopEtfs({ source: fixtureSource().source, today: '20261028', limit: 2 });
        const beforeList = await database.ingestionSelection.findMany();

        await expect(
          selectTopEtfs({ source: fixtureSource(options).source, today: '20261028', limit: 3 }),
        ).rejects.toThrow();
        expect(await database.ingestionSelection.findMany()).toEqual(beforeList);
      }),
  );

  it('keeps manual additions/removals and an initialized empty list while preserving historical prices', async () =>
    withSyncDatabase(async (database) => {
      await selectTopEtfs({ source: fixtureSource().source, today: '20261028', limit: 1 });
      await database.etfDaily.create({
        data: { tsCode: '500123.SH', tradeDate: '20261027', close: 1 },
      });
      await changeDownloadList('etf', 'add', '500001.SH');
      await changeDownloadList('etf', 'add', '500001.SH');
      expect(await readDownloadCodes('etf')).toEqual(['500001.SH', '500123.SH']);
      await changeDownloadList('etf', 'remove', '500123.SH');
      await changeDownloadList('etf', 'remove', '500001.SH');
      expect(await datasetScopes(policy('etf-prices'))).toEqual([]);
      expect(await listDownloads('etf')).toMatchObject({ initialized: true, rows: [] });
      expect(await database.etfDaily.count()).toBe(1);
      expect(await database.ingestionSelection.count()).toBe(1);
    }));

  it('does not schedule existing pending partitions for a removed ETF', async () =>
    withSyncDatabase(async (database) => {
      await database.ingestionSelection.createMany({
        data: [
          { assetType: 'etf', codes: [] },
          { assetType: 'index', codes: [] },
        ],
      });
      const planned = await planIngestion('20261027', new Date('2026-10-28T10:00:00Z'));

      expect(planned.units.some((row) => row.scope === '500000.SH')).toBe(false);
      expect(planned.blocked.some((entry) => /etf-prices|index-prices/.test(entry.dataset))).toBe(
        false,
      );
    }));

  it('initializes five indices once, retains manual edits and separates official valuation support', async () =>
    withSyncDatabase(async () => {
      await withMaintenanceLock(() => initializeIndexDownloads());
      expect(await readDownloadCodes('index')).toContain('000985.CSI');
      await changeDownloadList('index', 'add', '000016.SH');
      await changeDownloadList('index', 'remove', '000300.SH');
      await withMaintenanceLock(() => initializeIndexDownloads());

      expect(await readDownloadCodes('index')).not.toContain('000300.SH');
      expect((await datasetScopes(policy('index-prices'))).map((row) => row.scope)).toContain(
        '000016.SH',
      );
      expect(
        (await datasetScopes(policy('index-valuations'))).map((row) => row.scope),
      ).not.toContain('H00300.CSI');
      await expect(changeDownloadList('index', 'add', 'HSI.HI')).rejects.toThrow(
        'Invalid index code',
      );
    }));
});
