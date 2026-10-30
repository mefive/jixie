import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { selectSyncWindow } from './partitions.js';
import { writeFinancialPartition } from '#market/fundamentals/write.js';
import { normalizeStockIdentity } from '#market/instruments/normalize-identity.js';
import { STOCK_CODE_CHANGES } from '#market/instruments/stock-identity.js';
import { loadResearchEquityDividends } from '#research/datasets/supplemental.js';
import type { PreparedMarketPartition } from '#market/synchronization/partition.js';

const startedAt = new Date('2026-10-28T10:00:00Z');
const policy = (dataset: string) => DATASET_POLICIES.find((entry) => entry.dataset === dataset)!;

describe('minimal retained-data synchronization', () => {
  it('rotates dividend backfills independently of recent checks even after failed attempts', async () =>
    withSyncDatabase(async (database) => {
      const codes = ['600000.SH', '600001.SH', '600002.SH'];
      await database.stockBasic.createMany({
        data: codes.map((tsCode) => ({
          tsCode,
          symbol: tsCode.slice(0, 6),
          name: tsCode,
          listDate: '20000101',
          listStatus: 'L',
        })),
      });
      await database.datasetSyncState.createMany({
        data: codes.map((scope, index) => ({
          dataset: 'dividends',
          scope,
          lastCheckedAt: new Date([2000, 0, 1000][index]),
          lastBackfillAt: new Date([0, 2000, 1000][index]),
        })),
      });
      const input = {
        policy: policy('dividends'),
        targetDate: '20261027',
        startedAt,
        history: false,
        attempted: new Set<string>(),
        deadline: Date.now() + 30_000,
      };
      expect((await selectSyncWindow(input))?.scope).toBe(codes[1]);
      const visited: string[] = [];
      for (let attempt = 0; attempt < codes.length; attempt++) {
        const next = await selectSyncWindow({ ...input, history: true });
        expect(next).toMatchObject({ startDate: '20000101', endDate: '20001231' });
        visited.push(next!.scope);
        input.attempted.add(next!.id);
        await database.datasetSyncState.update({
          where: { dataset_scope: { dataset: 'dividends', scope: next!.scope } },
          data: { lastBackfillAt: startedAt },
        });
      }
      expect(visited).toEqual([codes[0], codes[2], codes[1]]);
      expect(await database.datasetSyncPartition.count()).toBe(0);
    }));

  it('rotates one hundred ETF objects, preserves a fixed historical hole and never writes plans', async () =>
    withSyncDatabase(async (database) => {
      const codes = Array.from({ length: 100 }, (_, index) => `${510000 + index}.SH`);
      await database.marketDownloadList.create({ data: { assetType: 'etf', codes } });
      await database.etfBasic.createMany({
        data: codes.map((tsCode) => ({
          tsCode,
          name: tsCode,
          listDate: '20200101',
          listStatus: 'L',
          exchange: 'SH',
          sameDayTurnover: false,
        })),
      });
      const attempted = new Set<string>();
      const seen = new Set<string>();
      for (let index = 0; index < codes.length; index++) {
        const selected = await selectSyncWindow({
          policy: policy('etf-prices'),
          targetDate: '20261027',
          startedAt,
          history: false,
          attempted,
          deadline: Date.now() + 30_000,
        });
        expect(selected).not.toBeNull();
        seen.add(selected!.scope);
        attempted.add(selected!.id);
        await database.datasetSyncState.upsert({
          where: { dataset_scope: { dataset: 'etf-prices', scope: selected!.scope } },
          create: { dataset: 'etf-prices', scope: selected!.scope, lastCheckedAt: startedAt },
          update: { lastCheckedAt: startedAt },
        });
      }
      expect([...seen].sort()).toEqual(codes);
      expect(await database.datasetSyncPartition.count()).toBe(0);
      await database.marketDownloadList.update({
        where: { assetType: 'etf' },
        data: { codes: [codes[0]] },
      });
      await database.datasetSyncPartition.createMany({
        data: [
          {
            id: 'first-year',
            dataset: 'etf-prices',
            scope: codes[0],
            startDate: '20200101',
            endDate: '20201231',
            policyVersion: 'sync-v2',
            status: 'complete',
          },
          {
            id: 'later-years',
            dataset: 'etf-prices',
            scope: codes[0],
            startDate: '20220101',
            endDate: '20251231',
            policyVersion: 'sync-v2',
            status: 'complete',
          },
          {
            id: 'fixed-failure',
            dataset: 'etf-prices',
            scope: codes[0],
            startDate: '20210101',
            endDate: '20211231',
            policyVersion: 'sync-v2',
            status: 'error',
          },
        ],
      });
      const next = await selectSyncWindow({
        policy: policy('etf-prices'),
        targetDate: '20261028',
        startedAt,
        history: true,
        attempted: new Set(),
        deadline: Date.now() + 30_000,
      });
      expect(next).toMatchObject({ startDate: '20210101', endDate: '20211231' });
    }));

  it('leaves completed old history alone while allowing an older explicit target to refresh it', async () =>
    withSyncDatabase(async (database) => {
      await database.marketDownloadList.create({
        data: { assetType: 'index', codes: ['000300.SH'] },
      });
      await database.datasetSyncPartition.create({
        data: {
          id: 'history',
          dataset: 'index-prices',
          scope: '000300.SH',
          startDate: '19900101',
          endDate: '20251231',
          status: 'complete',
          policyVersion: 'sync-v2',
          checkedAt: new Date(0),
        },
      });
      const input = {
        policy: policy('index-prices'),
        targetDate: '20261027',
        startedAt,
        history: false,
        attempted: new Set<string>(),
        deadline: Date.now() + 30_000,
      };
      expect(await selectSyncWindow(input)).toMatchObject({
        startDate: '20260101',
        endDate: '20261027',
      });
      expect(await selectSyncWindow({ ...input, targetDate: '20201231' })).toMatchObject({
        startDate: '20200101',
        endDate: '20201231',
      });
      expect(await database.datasetSyncPartition.count()).toBe(1);
    }));

  it('preserves same-value dividend capture, dates real corrections later, and retains capture through code succession', async () =>
    withSyncDatabase(async (database) => {
      const change = STOCK_CODE_CHANGES[0];
      await database.tradeCal.createMany({
        data: ['20260602', '20260603', '20261029'].map((calDate) => ({
          exchange: 'SSE',
          calDate,
          isOpen: 1,
        })),
      });
      const data = {
        id: 'legacy-id',
        tsCode: change.oldTsCode,
        endDate: '20251231',
        annDate: '20260301',
        exDate: '20260601',
        divProc: '实施',
        cashDiv: 0.9,
        cashDivTax: 1,
        observedAt: new Date('2026-06-02T02:00:00Z'),
        availabilityQuality: 'latest_only',
      };
      await database.dividend.create({ data });
      await database.$transaction((transaction) => normalizeStockIdentity(transaction, change));
      const normalized = await database.dividend.findFirstOrThrow();
      expect(normalized.observedAt).toEqual(data.observedAt);
      const window = {
        dataset: 'dividends',
        scope: change.newTsCode,
        startDate: '20250101',
        endDate: '20251231',
      };
      const prepared: PreparedMarketPartition = {
        tables: [
          {
            table: 'Dividend',
            records: [
              {
                values: {
                  id: normalized.id,
                  tsCode: change.newTsCode,
                  endDate: data.endDate,
                  annDate: data.annDate,
                  exDate: data.exDate,
                  divProc: '实施',
                  cashDiv: 0.9,
                  cashDivTax: 1,
                },
              },
            ],
          },
        ],
        status: 'partial',
        gaps: [],
        errors: [],
        observedDates: [],
        checks: {
          terminalPage: false,
          sourceFailed: false,
          emptyResponse: false,
          invalidRows: 0,
          pages: 1,
          sourceRows: 1,
        },
      };
      const unchanged = await database.$transaction((transaction) =>
        writeFinancialPartition(transaction, prepared, window, startedAt),
      );
      expect(unchanged.changed).toBe(false);
      expect(
        await loadResearchEquityDividends({
          identifier: change.newTsCode,
          start: '20260601',
          end: '20261028',
        }),
      ).toMatchObject([{ date: '20260603', cash_dividend_pre_tax: 1 }]);
      prepared.tables[0].records[0].values.cashDivTax = 2;
      await database.$transaction((transaction) =>
        writeFinancialPartition(transaction, prepared, window, startedAt),
      );
      expect(
        await loadResearchEquityDividends({
          identifier: change.newTsCode,
          start: '20260601',
          end: '20261028',
        }),
      ).toEqual([]);
      expect(
        await loadResearchEquityDividends({
          identifier: change.newTsCode,
          start: '20261029',
          end: '20261029',
        }),
      ).toMatchObject([{ cash_dividend_pre_tax: 2, date: '20261029' }]);
    }));
});
