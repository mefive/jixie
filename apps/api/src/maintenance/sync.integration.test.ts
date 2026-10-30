import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadIndicatorVersions } from '#market/fundamentals/indicator-versions.js';
import { normalizeStockIdentity } from '#market/instruments/normalize-identity.js';
import { STOCK_CODE_CHANGES, stockCodeAt } from '#market/instruments/stock-identity.js';
import { describe, expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { writeFixture as acceptMarketPartition } from '../../tests/sync-fixtures.js';
import { datasetInputReadiness, marketRevision } from '#market/synchronization/readiness.js';
import { contiguousCoverage } from '#market/synchronization/coverage.js';
import { prepareIndexPartition } from '#market/indices/sync-partition.js';
import { getMaintenanceStatus } from './status.js';
import { selectFixtureWindows as planSyncPartitions } from '../../tests/sync-fixtures.js';
import { synchronizeData } from './sync.js';
import type { PreparedMarketPartition, SourceRecord } from '#market/synchronization/partition.js';
import type { SyncProviders } from '#market/synchronization/prepare.js';
import {
  withMaintenanceLock,
  withMarketAccess,
  withMarketPublication,
  MarketAccessBusyError,
} from '#infra/coordination/market-access.js';

const fetchedAt = new Date('2026-09-16T10:00:00Z');
const daily = (code: string, date: string, close: number): SourceRecord => ({
  values: { tsCode: code, tradeDate: date, close },
});
const prepared = (
  records: SourceRecord[],
  status: PreparedMarketPartition['status'] = 'partial',
): PreparedMarketPartition => ({
  tables: [{ table: 'Daily', records }],
  status,
  checks: {
    terminalPage: false,
    sourceFailed: false,
    invalidRows: 0,
    emptyResponse: false,
    pages: 1,
    sourceRows: records.length,
  },
  gaps: [],
  errors: [],
  observedDates: records.map((record) => String(record.values.tradeDate)),
});

function providers(): SyncProviders {
  return {
    source: { call: async () => [] },
  };
}

describe('unified synchronization acceptance', () => {
  it(
    'A02/A07 starts empty inventories, retains real source errors, and leaves the product available',
    async () =>
      withSyncDatabase(async (database) => {
        const result = await synchronizeData({
          targetDate: '20260915',
          startedAt: fetchedAt,
          providers: providers(),
          onLog: () => {},
        });
        expect(result.partitions).toBeGreaterThan(0);
        expect(result.partitions).toBeLessThanOrEqual(240);
        expect(result.status).toBe('error');
        expect(
          await database.datasetSyncPartition.count({ where: { status: 'error' } }),
        ).toBeGreaterThan(0);
        expect(await getMaintenanceStatus()).toMatchObject({
          active: false,
          running: false,
          phase: 'error',
        });
      }),
    60_000,
  );

  it('A03/A05/A11 merges partial batches, preserves omitted/unknown fields and remains idempotent', async () =>
    withSyncDatabase(async (database) => {
      const first = prepared([
        { values: { tsCode: '600000.SH', tradeDate: '20260914', close: 10, amount: 50 } },
      ]);
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, first, 'stock-prices', fetchedAt),
      );
      const second = prepared([
        { values: { tsCode: '600000.SH', tradeDate: '20260914', close: 11, amount: null } },
        daily('000001.SZ', '20260914', 20),
      ]);
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, second, 'stock-prices', fetchedAt),
      );
      const unchanged = await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, second, 'stock-prices', fetchedAt),
      );
      expect(unchanged.changed).toBe(false);
      expect(await database.daily.findMany()).toHaveLength(2);
      expect(
        await database.daily.findUniqueOrThrow({
          where: { tsCode_tradeDate: { tsCode: '600000.SH', tradeDate: '20260914' } },
        }),
      ).toMatchObject({ close: 11, amount: 50 });
      expect(
        (
          await datasetInputReadiness([
            { dataset: 'stock-prices', scope: 'all', startDate: '20260914', endDate: '20260915' },
          ])
        ).ready,
      ).toBe(false);
    }));

  it('A06 deletes only a proven exact empty extent and applies authoritative null corrections', async () =>
    withSyncDatabase(async (database) => {
      await database.daily.createMany({
        data: [
          { tsCode: '600000.SH', tradeDate: '20260914', close: 10, amount: 30 },
          { tsCode: '600000.SH', tradeDate: '20260915', close: 11 },
        ],
      });
      const corrected = prepared([
        {
          values: { tsCode: '600000.SH', tradeDate: '20260914', close: 10, amount: null },
          authoritativeNulls: ['amount'],
        },
      ]);
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, corrected, 'stock-prices', fetchedAt),
      );
      expect(
        (await database.daily.findFirstOrThrow({ where: { tradeDate: '20260914' } })).amount,
      ).toBeNull();
      const empty = prepared([], 'partial');
      empty.tables[0].replace = false;
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, empty, 'stock-prices', fetchedAt),
      );
      expect(await database.daily.count()).toBe(2);
      empty.status = 'complete';
      empty.tables[0].replace = true;
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, empty, 'stock-prices', fetchedAt),
      );
      expect(await database.daily.findMany()).toMatchObject([{ tradeDate: '20260915' }]);
    }));

  it('A04/A10 schedules an older hole after newer observations without using a max-date watermark', async () =>
    withSyncDatabase(async (database) => {
      await database.datasetSyncPartition.create({
        data: {
          id: 'verified-calendar',
          dataset: 'calendar',
          scope: 'SSE',
          startDate: '20150101',
          endDate: '20260916',
          policyVersion: 'sync-v2',
          status: 'complete',
        },
      });
      await database.tradeCal.createMany({
        data: [
          { exchange: 'SSE', calDate: '20260915', isOpen: 1 },
          { exchange: 'SSE', calDate: '20260916', isOpen: 1 },
        ],
      });
      await database.datasetSyncState.create({
        data: {
          dataset: 'stock-prices',
          scope: 'all',

          maxObservedDate: '20260916',
        },
      });
      await database.datasetSyncPartition.create({
        data: {
          id: createHash('sha256')
            .update(JSON.stringify(['stock-prices', 'all', '20260915', '20260915']))
            .digest('hex'),
          dataset: 'stock-prices',
          scope: 'all',
          startDate: '20260915',
          endDate: '20260915',
          policyVersion: 'sync-v2',
          status: 'waiting',
        },
      });
      const plan = await planSyncPartitions({
        targetDate: '20260916',
        startedAt: fetchedAt,
      });
      expect(
        plan.partitions.some(
          (partition) => partition.startDate === '20260915' && partition.dataset === 'stock-prices',
        ),
      ).toBe(true);
      expect(
        contiguousCoverage(
          '20260914',
          [
            { startDate: '20260914', endDate: '20260914' },
            { startDate: '20260916', endDate: '20260916' },
          ],
          ['20260914', '20260915', '20260916'],
        ),
      ).toBe('20260914');
    }));

  it('A05/A06 rejects a half economic snapshot without publishing its members', async () => {
    const source = {
      call: vi
        .fn()
        .mockResolvedValue([
          { index_code: '000300.SH', con_code: '600000.SH', trade_date: '20260915', weight: 20 },
        ]),
    };
    const partition = await prepareIndexPartition(source, {
      dataset: 'index-weights',
      scope: '000300.SH',
      startDate: '20260901',
      endDate: '20260930',
    });
    expect(partition.status).toBe('error');
    expect(partition.tables.flatMap((table) => table.records)).toHaveLength(0);
  });

  it('A11 rolls back values and revision together at the publication boundary', async () =>
    withSyncDatabase(async (database) => {
      await database.marketDataState.create({ data: { key: 'global' } });
      await expect(
        database.$transaction(async (transaction) => {
          await acceptMarketPartition(
            transaction,
            prepared([daily('600000.SH', '20260915', 10)]),
            'stock-prices',
            fetchedAt,
          );
          await transaction.marketDataState.update({
            where: { key: 'global' },
            data: { revision: { increment: 1 } },
          });
          throw new Error('injected boundary failure');
        }),
      ).rejects.toThrow('injected');
      expect(await database.daily.count()).toBe(0);
      expect(await marketRevision()).toBe(0);
    }));

  it('A12 serializes writers and holds a stable user read through completion', async () =>
    withSyncDatabase(async () => {
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writer = withMaintenanceLock(async () => {
        entered();
        await gate;
      });
      await started;
      await expect(withMaintenanceLock(async () => {})).rejects.toBeInstanceOf(
        MarketAccessBusyError,
      );
      release();
      await writer;
      let readerFinished = false;
      await withMarketAccess(async () => {
        await Promise.resolve();
        readerFinished = true;
      });
      expect(readerFinished).toBe(true);
      await withMaintenanceLock(() => withMarketPublication(async () => {}));
    }));
  it('A09 keeps latest-only ratios unavailable before actual capture, retaining older versions', async () =>
    withSyncDatabase(async (database) => {
      await database.finaIndicator.create({
        data: { tsCode: '600000.SH', endDate: '20251231', annDate: '20260301', roe: 99 },
      });
      await database.finaIndicatorVersion.createMany({
        data: [
          {
            id: 'first',
            tsCode: '600000.SH',
            endDate: '20251231',
            annDate: '20260301',
            availableDate: '20260914',
            availabilityQuality: 'latest_only',
            observedAt: fetchedAt,
            sourceFingerprint: 'first',
            roe: 10,
          },
          {
            id: 'correction',
            tsCode: '600000.SH',
            endDate: '20251231',
            annDate: '20260301',
            availableDate: '20260916',
            availabilityQuality: 'latest_only',
            observedAt: fetchedAt,
            sourceFingerprint: 'correction',
            roe: 11,
          },
        ],
      });
      expect(await loadIndicatorVersions({ endDate: '20260913' })).toEqual([]);
      expect(await loadIndicatorVersions({ endDate: '20260915' })).toMatchObject([{ roe: 10 }]);
      expect(await database.finaIndicatorVersion.count()).toBe(2);
    }));

  it('A06 reconciles confirmed identities once and refuses conflicting lineages', async () =>
    withSyncDatabase(async (database) => {
      const change = STOCK_CODE_CHANGES[0];
      await database.daily.create({
        data: { tsCode: change.oldTsCode, tradeDate: '20250102', close: 10 },
      });
      await database.$transaction((transaction) => normalizeStockIdentity(transaction, change));
      expect(await database.daily.findMany()).toMatchObject([
        { tsCode: change.newTsCode, close: 10 },
      ]);
      expect(stockCodeAt(change.newTsCode, '20000101')).toBe(change.oldTsCode);
      await database.daily.create({
        data: { tsCode: change.oldTsCode, tradeDate: '20250102', close: 12 },
      });
      await expect(
        database.$transaction((transaction) => normalizeStockIdentity(transaction, change)),
      ).rejects.toThrow('identity conflict');
      expect(await database.daily.count()).toBe(2);
    }));

  it(
    'A13 leaves legacy candidate directories untouched during normal synchronization',
    async () =>
      withSyncDatabase(async (_database, directory) => {
        const retired = join(directory, 'maintenance-staging', 'UNOWNED');
        await mkdir(retired, { recursive: true });
        await writeFile(join(retired, 'candidate.db'), 'fixture candidate');
        await synchronizeData({
          targetDate: '20260915',
          startedAt: fetchedAt,
          providers: providers(),
          onLog: () => {},
        });
        expect(await readFile(join(retired, 'candidate.db'), 'utf8')).toBe('fixture candidate');
        await expect(access(retired)).resolves.toBeUndefined();
      }),
    30_000,
  );
});
