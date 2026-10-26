import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadIndicatorVersions } from '#market/fundamentals/indicator-versions.js';
import { prepareIdentityNormalization } from '#market/instruments/normalize-identity.js';
import { STOCK_CODE_CHANGES, stockCodeAt } from '#market/instruments/stock-identity.js';
import { cleanRetiredSyncResources } from './resources.js';
import { acquireWorkOwner } from '#infra/coordination/market-access.js';
import { describe, expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { acceptMarketPartition } from '#market/synchronization/records.js';
import { datasetInputReadiness, marketRevision } from '#market/synchronization/readiness.js';
import { contiguousCoverage } from '#market/synchronization/coverage.js';
import { prepareStockPartition } from '#market/stocks/sync-partition.js';
import { prepareIndexPartition } from '#market/indices/sync-partition.js';
import { getMaintenanceStatus } from './status.js';
import { invalidateMarketCalculations, refreshMarketCalculations } from './calculations.js';
import { planSyncPartitions } from './partitions.js';
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
  evidence: {},
  gaps: [],
  errors: [],
  observedDates: records.map((record) => String(record.values.tradeDate)),
});

function providers(): SyncProviders {
  return {
    source: { call: async () => [] },
    treasury: { fetchRange: async () => [] },
    credit: { fetchRange: async () => [] },
    cpi: { loadSeries: async () => [] },
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
          requirements: { etfCodes: [] },
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
      expect(unchanged.changes).toHaveLength(0);
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
      empty.tables[0].replacement = {
        authoritative: true,
        basis: 'Explicit fixture withdrawal',
        where: { tradeDate: '20260914' },
      };
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, empty, 'stock-prices', fetchedAt),
      );
      expect(await database.daily.count()).toBe(2);
      empty.status = 'complete';
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, empty, 'stock-prices', fetchedAt),
      );
      expect(await database.daily.findMany()).toMatchObject([{ tradeDate: '20260915' }]);
    }));

  it('A04/A10 schedules an older hole after newer observations without using a max-date watermark', async () =>
    withSyncDatabase(async (database) => {
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
          historyStart: '20150101',
          backfillCursor: '20150101',
          plannedThrough: '20260916',
          maxObservedDate: '20260916',
          policyVersion: 'sync-v1',
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
          policyVersion: 'sync-v1',
          status: 'waiting',
          nextAttemptAt: new Date(0),
        },
      });
      const plan = await planSyncPartitions({
        targetDate: '20260916',
        startedAt: fetchedAt,
        requirements: { etfCodes: [] },
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

  it('A08 treats missing money-flow components as unknown and retains an independent valid price', async () => {
    const source = {
      call: async (api: string) =>
        api === 'moneyflow'
          ? [{ ts_code: '600000.SH', trade_date: '20260915', buy_lg_amount: 10 }]
          : [{ ts_code: '600000.SH', trade_date: '20260915', close: 10 }],
    };
    const flow = await prepareStockPartition(source, {
      dataset: 'stock-moneyflow',
      scope: 'all',
      startDate: '20260915',
      endDate: '20260915',
    });
    expect(flow.tables[0].records[0].values.netMain).toBeNull();
    const price = await prepareStockPartition(source, {
      dataset: 'stock-prices',
      scope: 'all',
      startDate: '20260915',
      endDate: '20260915',
    });
    expect(price.tables[0].records[0].values.close).toBe(10);
  });

  it('invalidates retained commodity returns without creating weather tasks for stock changes', async () =>
    withSyncDatabase(async (database) => {
      await database.futureMapping.createMany({
        data: ['20260914', '20260915'].map((tradeDate) => ({
          continuousCode: 'AU.SHF',
          tradeDate,
          mappedTsCode: 'AU2610.SHF',
        })),
      });
      await database.$transaction((transaction) =>
        invalidateMarketCalculations(transaction, [
          {
            table: 'FutureDaily',
            before: { tsCode: 'AU2610.SHF', tradeDate: '20260914', settle: 9 },
            after: { tsCode: 'AU2610.SHF', tradeDate: '20260914', settle: 10 },
          },
          {
            table: 'Daily',
            before: { tsCode: '600000.SH', tradeDate: '20260914', close: 9 },
            after: { tsCode: '600000.SH', tradeDate: '20260914', close: 10 },
          },
        ]),
      );

      expect(
        await database.marketCalculationState.findMany({
          select: { kind: true, date: true, status: true },
          orderBy: { date: 'asc' },
        }),
      ).toEqual([
        { kind: 'commodity-continuous', date: '20260914', status: 'stale' },
        { kind: 'commodity-continuous', date: '20260915', status: 'stale' },
      ]);
    }));

  it('A11 rolls back values, provenance and revision together at the publication boundary', async () =>
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
      expect(await database.marketRecordEvidence.count()).toBe(0);
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

  it('A10/A11 recomputes a version change even when raw records do not change', async () =>
    withSyncDatabase(async (database) => {
      await database.marketDataState.create({ data: { key: 'global' } });
      await database.marketCalculationState.create({
        data: {
          kind: 'commodity-continuous',
          scope: 'all',
          date: '20260915',
          status: 'ready',
          calculationVersion: 'retired-formula',
          auditVersion: 'retired-audit',
        },
      });
      await withMaintenanceLock(() =>
        refreshMarketCalculations({ targetDate: '20260915', limit: 0 }),
      );
      expect(await database.marketCalculationState.findFirstOrThrow()).toMatchObject({
        status: 'stale',
        generation: 2,
        calculationVersion: 'market-state-sync-v2',
      });
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
      const normalization = await database.$transaction((transaction) =>
        prepareIdentityNormalization(transaction, change),
      );
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, normalization, 'identity-normalization', fetchedAt),
      );
      expect(await database.daily.findMany()).toMatchObject([
        { tsCode: change.newTsCode, close: 10 },
      ]);
      expect(stockCodeAt(change.newTsCode, '20000101')).toBe(change.oldTsCode);
      await database.daily.create({
        data: { tsCode: change.oldTsCode, tradeDate: '20250102', close: 12 },
      });
      await expect(
        database.$transaction((transaction) => prepareIdentityNormalization(transaction, change)),
      ).rejects.toThrow('identity conflict');
      expect(await database.daily.count()).toBe(2);
    }));

  it('A13 preserves live and unowned retired files, reclaiming only an inactive proven owner', async () =>
    withSyncDatabase(async (database, directory) => {
      const root = join(directory, 'maintenance-staging');
      const retired = join(root, 'ACTIVE1');
      await mkdir(retired, { recursive: true });
      await mkdir(join(root, 'UNOWNED'));
      const manifest = {
        protocol: 2,
        id: 'ACTIVE1',
        command: 'daily',
        timestamp: fetchedAt.toISOString(),
        phase: 'preparing',
        snapshot: { schemaHash: 'fixture', baseRevision: 0, tables: [] },
        changes: [],
      };
      await writeFile(join(retired, 'manifest.json'), JSON.stringify(manifest));
      await writeFile(join(retired, 'candidate.db'), 'fixture candidate');
      await database.maintenanceRun.create({
        data: {
          id: 'ACTIVE1',
          kind: 'daily',
          targetKey: 'candidate:ACTIVE1',
          trigger: 'manual',
          status: 'error',
          stage: 'retired',
          summary: manifest,
        },
      });
      await withMaintenanceLock(async () => {
        const owner = await acquireWorkOwner('postprocess', 'ACTIVE1');
        try {
          expect(await cleanRetiredSyncResources()).toEqual(
            expect.arrayContaining([
              expect.stringContaining('active retired resource'),
              expect.stringContaining('unverified retired resource'),
            ]),
          );
          expect(await readFile(join(retired, 'candidate.db'), 'utf8')).toBe('fixture candidate');
        } finally {
          await owner.release();
        }
        await cleanRetiredSyncResources();
        await expect(access(retired)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(access(join(root, 'UNOWNED'))).resolves.toBeUndefined();
      });
    }));
});
